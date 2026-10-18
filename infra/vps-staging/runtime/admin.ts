// Restrict the existing admin bootstrap to a synthetic identity in the development instance.
import {createClerkClient} from '@clerk/backend';
try {
 if(process.env.DEPLOYMENT_ENV!=='staging'||process.env.AIA_SYNTHETIC_DATA!=='true'||process.env.AIA_STAGE_PROJECT!=='aia-accreditation-staging'||!process.env.CLERK_SECRET_KEY?.startsWith('sk_test_'))throw Error('TARGET');
 const u=new URL(process.env.DATABASE_URL!);if(u.hostname!=='postgres'||u.pathname!=='/aia_accreditation_staging')throw Error('DB');
 const clerk=createClerkClient({secretKey:process.env.CLERK_SECRET_KEY});
 const user=await clerk.users.getUser(process.env.CLERK_ADMIN_USER_ID!);
 if(!user.emailAddresses.length||user.emailAddresses.some(e=>!e.emailAddress.includes('+clerk_test@')))throw Error('SYNTHETIC_EMAIL_REQUIRED');
 await import('../scripts/bootstrap-admin.ts');
}catch{console.error('SYNTHETIC_ADMIN_BOOTSTRAP_FAILED');process.exitCode=1;}
