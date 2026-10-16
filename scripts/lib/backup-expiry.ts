export function approvedBackupExpiry(env:Record<string,string|undefined>,now=new Date()) {
 let expiry:Date;
 if(env.BACKUP_APPROVED_EXPIRY)expiry=new Date(env.BACKUP_APPROVED_EXPIRY);
 else {const hours=Number(env.BACKUP_RETENTION_HOURS);if(!env.BACKUP_POLICY_REFERENCE||env.BACKUP_POLICY_REFERENCE.trim().length<5||!Number.isFinite(hours)||hours<=0)throw Error('APPROVED_BACKUP_RETENTION_REQUIRED');expiry=new Date(now.getTime()+hours*3600000);}
 if(!Number.isFinite(expiry.getTime())||expiry<=now)throw Error('APPROVED_FUTURE_BACKUP_EXPIRY_REQUIRED');return expiry;
}
