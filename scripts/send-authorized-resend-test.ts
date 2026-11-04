import { readFile, writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { sendSingleAuthorizedTest } from "../packages/email/src/authorized-test.ts";

const directory=resolve(".impeccable/releases/resend-one-test");
const receiptFile=resolve(directory,"receipt.json"), keyFile=resolve(directory,"send.key");
try {
  let previous: string | undefined;
  try { previous=await readFile(receiptFile,"utf8"); } catch { /* No receipt yet. */ }
  if(previous){console.log(JSON.stringify({status:"ALREADY_SENT",...JSON.parse(previous)}));}
  else {
    const authorization=JSON.parse((await readFile(resolve(directory,"authorization.json"),"utf8")).replace(/^\uFEFF/,""));
    if(authorization.to!=="lukevidor@gmail.com"||authorization.from!=="notificacoes@notify.joinaia.pt"||!/^aia-monitor-test\/[a-f0-9-]{36}$/.test(authorization.idempotencyKey)||Date.now()-new Date(authorization.authorizedAt).getTime()>23*3600000||!Number.isFinite(new Date(authorization.authorizedAt).getTime()))throw new Error("ONE_TEST_AUTHORIZATION_REQUIRED");
    const key=(await readFile(keyFile,"utf8")).trim();
    if(!/^re_[A-Za-z0-9_-]+$/.test(key))throw new Error("PRIVATE_SENDING_KEY_REQUIRED");
    const providerMessageId=await sendSingleAuthorizedTest(key,authorization.idempotencyKey);
    const receipt={to:"lukevidor@gmail.com",providerMessageId,acceptedAt:new Date().toISOString()};
    await writeFile(receiptFile,JSON.stringify(receipt),{flag:"wx",mode:0o600});
    await unlink(keyFile);
    console.log(JSON.stringify({status:"ACCEPTED_BY_RESEND",...receipt}));
  }
} catch {console.error("RESEND_ONE_TEST_UNAVAILABLE_CHECK_PRIVATE_AUTHORIZATION_OR_PROVIDER_ACCESS");process.exitCode=1;}
