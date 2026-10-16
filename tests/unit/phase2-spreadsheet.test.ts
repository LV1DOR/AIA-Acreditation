import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { importHeaders, internalTemplate, readInternalSpreadsheet, MAX_IMPORT_BYTES } from "../../packages/domain/src/internal/spreadsheet.ts";
const csv=(values:string[])=>Buffer.from(importHeaders.join(",")+"\n"+values.map(v=>'"'+v.replaceAll('"','""')+'"').join(","));
const values=["Synthetic Worker","1990-01-01","PASSPORT","001234567","2035-01-01","+351912345678","PT","AIA",randomUUID(),"2026-10-01;2026-10-02",randomUUID(),"employee-001.jpg","EMP001"];
const context={event:{id:randomUUID(),name:"Synthetic event",startDate:new Date("2026-10-01"),endDate:new Date("2026-10-03")},organisation:"AIA" as const,zones:[{id:values[10]!,name:"Paddock"}],roles:[{id:values[8]!,name:"Operations"}]};
type Workbook={definedNames:{getRanges:(name:string)=>{ranges:string[]}},xlsx:{load:(b:Buffer)=>Promise<void>;writeBuffer:()=>Promise<Buffer>};getWorksheet:(name:string)=>{getCell:(row:number,column:number)=>{value:unknown;numFmt:string;dataValidation:{type:string;formulae:string[]}};getRow:(row:number)=>{values:unknown[]}}};
const Excel=createRequire(new URL("../../packages/domain/package.json",import.meta.url))("exceljs") as {Workbook:new()=>Workbook};
it("preserves text IDs, international phones and per-person semicolon lists in UTF-8 CSV",async()=>{
  const rows=await readInternalSpreadsheet(csv(values),"workers.csv");
  expect(rows[0]?.["Número de Documento"]).toBe("001234567");
  expect(rows[0]?.["Telemóvel"]).toBe("+351912345678");
  expect(rows[0]?.["Zonas de Acesso"]).toBe(values[10]);
});
it("reads a semicolon-delimited CSV with BOM and quoted multi-values",async()=>{
  const body="\uFEFF"+importHeaders.map(v=>'"'+v+'"').join(";")+"\r\n"+values.map(v=>'"'+v+'"').join(";");
  expect((await readInternalSpreadsheet(Buffer.from(body),"workers.csv"))[0]?.["Dias de Trabalho"]).toBe(values[9]);
});
it("reads an Excel-style UTF-8 BOM with unquoted comma-delimited headings",async()=>{
  expect((await readInternalSpreadsheet(Buffer.concat([Buffer.from("\uFEFF"),csv(values)]),"workers.csv"))[0]?.["Número de Documento"]).toBe("001234567");
});
it.each(["=HYPERLINK(\"https://example.com\")","@SUM(A1)","-cmd(1)"])("rejects formula-like cell input %s",async value=>{
  const row=[...values];row[0]=value;
  await expect(readInternalSpreadsheet(csv(row),"workers.csv")).rejects.toThrow("INVALID_SPREADSHEET");
});
it("rejects excessive bytes, excessive rows, malformed CSV and incompatible headers",async()=>{
  await expect(readInternalSpreadsheet(Buffer.alloc(MAX_IMPORT_BYTES+1),"workers.csv")).rejects.toThrow("INVALID_SPREADSHEET");
  await expect(readInternalSpreadsheet(Buffer.from(importHeaders.join(",")+"\n"+Array(1001).fill(values.map(v=>'"'+v+'"').join(",")).join("\n")),"workers.csv")).rejects.toThrow("INVALID_SPREADSHEET");
  await expect(readInternalSpreadsheet(Buffer.from("Name,Zone\nA,B"),"workers.csv")).rejects.toThrow("INVALID_SPREADSHEET");
  await expect(readInternalSpreadsheet(Buffer.from(importHeaders.join(",")+'\n"unclosed'),"workers.csv")).rejects.toThrow("INVALID_SPREADSHEET");
});
it("generates the selected event's UUID references, formats, dropdowns and reads a filled XLSX",async()=>{
  const b=await internalTemplate(context),w=new Excel.Workbook();await w.xlsx.load(b);
  expect(w.getWorksheet("Zones").getCell(2,1).value).toBe(values[10]);
  expect(w.getWorksheet("Zones").getCell(2,3).value).toBe("Synthetic event");
  expect(w.getWorksheet("Workers").getCell(2,4).numFmt).toBe("@");
  expect(w.getWorksheet("Workers").getCell(2,3).dataValidation.type).toBe("list");
  expect(w.getWorksheet("Workers").getCell(2,9).dataValidation.formulae).toEqual(["JobRoleIds"]);
  expect(w.definedNames.getRanges("JobRoleIds").ranges).toContain("Roles!$A$2");
  w.getWorksheet("Workers").getRow(2).values=values;
  const rows=await readInternalSpreadsheet(await w.xlsx.writeBuffer(),"workers.xlsx");
  expect(rows).toHaveLength(1);expect(rows[0]?.["Número de Documento"]).toBe("001234567");
});
it("rejects malformed XLSX, executable formulas and numeric document IDs",async()=>{
  await expect(readInternalSpreadsheet(Buffer.from("PK malformed"),"workers.xlsx")).rejects.toThrow("INVALID_SPREADSHEET");
  const w=new Excel.Workbook();await w.xlsx.load(await internalTemplate(context));
  w.getWorksheet("Workers").getRow(2).values=values;
  w.getWorksheet("Workers").getCell(2,1).value={formula:"1+1",result:2};
  await expect(readInternalSpreadsheet(await w.xlsx.writeBuffer(),"workers.xlsx")).rejects.toThrow("INVALID_SPREADSHEET");
  w.getWorksheet("Workers").getCell(2,1).value=values[0];w.getWorksheet("Workers").getCell(2,4).value=1234;
  await expect(readInternalSpreadsheet(await w.xlsx.writeBuffer(),"workers.xlsx")).rejects.toThrow("INVALID_SPREADSHEET");
});
