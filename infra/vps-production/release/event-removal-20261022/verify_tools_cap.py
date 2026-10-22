"""Operator read-only preflight. Prints only the tools service's public RAM caps."""
import sys
from pathlib import Path
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT));sys.path.insert(0,str(ROOT.parents[1]/'scripts'))
import json,production
from common import operation_lock,safe_main
from quiesced_capacity import verify_tools_cap

def main():
    with operation_lock():
        service=production.cfg()['services']['tools']
        print(json.dumps({'readOnly':True,'rawMemory':service.get('mem_limit'),'rawMemoryAndSwap':service.get('memswap_limit'),
            'memoryEncoding':type(service.get('mem_limit')).__name__,'swapEncoding':type(service.get('memswap_limit')).__name__}),flush=True)
        print(json.dumps(verify_tools_cap(service)),flush=True)
        print('TOOLS_768_MIB_CAP_VERIFIED_NO_SERVICES_CHANGED')
if __name__=='__main__':safe_main(main)
