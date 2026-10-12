import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  siteName: process.env.SITE_NAME || 'Roxbox',
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT) || 3000,
  // Base URL dùng để tạo link chia sẻ (vd: https://files.example.com). Bỏ trống = theo domain đang truy cập.
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/+$/, ''),
  maxUploadBytes: (Number(process.env.MAX_UPLOAD_MB) || 200) * 1024 * 1024,
  allowRegister: process.env.ALLOW_REGISTER !== '0',
  // Username và password đều phải có ít nhất chừng này ký tự.
  minCredentialLength: 6,
  maxUsernameLength: 32,
  maxPasswordLength: 128,
  sessionDays: 30,
  secureCookies: process.env.SECURE_COOKIES === '1',
  trustProxy: process.env.TRUST_PROXY === '1',
  paths: {
    root,
    public: path.join(root, 'public'),
    storage: path.join(root, 'storage'),
    tmp: path.join(root, 'storage', '.tmp'),
    data: process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(root, 'data'),
  },
};
