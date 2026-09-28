import { getUserById, loginUser, registerUser } from '../services/auth.service.js';
import { sendSuccess } from '../utils/apiResponse.js';

/** POST /api/auth/register */
export const register = async (req, res) => {
  const { user, token } = await registerUser(req.body);
  return sendSuccess(res, { user, token }, 201, 'Account created successfully');
};

/** POST /api/auth/login */
export const login = async (req, res) => {
  const { user, token } = await loginUser(req.body);
  return sendSuccess(res, { user, token }, 200, 'Logged in successfully');
};

/** GET /api/auth/me (protected by `authenticate`) */
export const me = async (req, res) => {
  const user = await getUserById(req.user.id);
  return sendSuccess(res, { user }, 200, 'Authenticated user');
};
