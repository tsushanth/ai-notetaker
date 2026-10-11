// Admin gate for /api/admin/*: runs after `authenticate` (which answers 401 for a missing, invalid or expired token), so a
// signed-in non-admin sees 404 and the existence of these routes is not revealed. Allowlist: ADMIN_EMAILS (comma separated).
const adminEmails = () => (process.env.ADMIN_EMAILS || 't.sushanth@gmail.com').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);

const isAdminEmail = (email) => {
  const e = String(email || '').trim().toLowerCase();
  return !!e && adminEmails().includes(e);
};

function adminOnly(req, res, next) {
  if (!isAdminEmail(req.userEmail)) return res.status(404).json({ success: false, error: 'Not found' });
  next();
}

module.exports = { adminOnly, isAdminEmail };
