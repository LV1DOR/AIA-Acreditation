import type {Instrumentation} from "next";
export const onRequestError:Instrumentation.onRequestError=async()=>{if(process.env.NEXT_RUNTIME==="nodejs"){const {recordRequestFailure}=await import("./server/operational-metrics.ts");await recordRequestFailure();}};
