import { Router } from 'express';
import {
  register, login, demoLogin, refreshToken, logout, me, updateMe, changePassword,
  acceptInvite, inviteInfo, orgSignupInfo, approveOrgSignup,
  forgotPassword, resetPassword,
  googleLogin, googleStatus, linkGoogleAccount, unlinkGoogleAccount,
  entraLoginRedirect, entraCallback,
} from './auth.controller';
import { authenticate } from '../../../middleware/authenticate';

export const authRouter = Router();
authRouter.post('/register', register);
authRouter.post('/login', login);
// Public, no body required — see demoLogin() for why this is safe.
authRouter.post('/demo-login', demoLogin);
authRouter.post('/refresh', refreshToken);
authRouter.post('/logout', logout);
authRouter.get('/invite-info', inviteInfo);
authRouter.post('/accept-invite', acceptInvite);
// Public + token-secured, same pattern as invite-info/accept-invite above —
// the reviewer is clicking a link from an email, not logged into the app.
authRouter.get('/org-signup-info', orgSignupInfo);
authRouter.post('/approve-org-signup', approveOrgSignup);
// Public, email-enumeration-safe (see forgotPassword()) — same generic-
// response pattern as the customer portal's request-access flow.
authRouter.post('/forgot-password', forgotPassword);
authRouter.post('/reset-password', resetPassword);
// Public — Google verifies the token; see googleLogin() for why this can't
// create new users/orgs.
authRouter.post('/google', googleLogin);
authRouter.get('/google/status', authenticate, googleStatus);
authRouter.post('/google/link', authenticate, linkGoogleAccount);
authRouter.delete('/google/link', authenticate, unlinkGoogleAccount);
// Public — Microsoft redirects the browser through these; org is resolved
// from the slug / signed state param, not a session. See entraLoginRedirect/
// entraCallback for why this can't create new users/orgs either.
authRouter.get('/entra/:slug/login', entraLoginRedirect);
authRouter.get('/entra/callback', entraCallback);
authRouter.get('/me', authenticate, me);
authRouter.put('/me', authenticate, updateMe);
authRouter.put('/me/password', authenticate, changePassword);
