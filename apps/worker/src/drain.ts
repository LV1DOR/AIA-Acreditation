export async function drainTasks(tasks:Iterable<Promise<unknown>>,timeoutMs:number) {
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([Promise.allSettled([...tasks]).then(()=>true),new Promise<boolean>(resolve=>{timer=setTimeout(()=>resolve(false),timeoutMs);})]);}
  finally{if(timer)clearTimeout(timer);}
}
