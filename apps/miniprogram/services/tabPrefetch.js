// One-use, short-lived first-page responses. Never persist account data to disk.
const entries = new Map();
const TTL = 15000;
let scheduledOwner = '';
function identity() {
  const auth = require('./auth');
  return typeof auth.getAccessToken === 'function' ? auth.getAccessToken() : '';
}
function preload(key, loader) {
  const owner = identity();
  if (!owner) return;
  const entry = { owner, expires: Date.now() + TTL };
  entry.promise = Promise.resolve().then(loader);
  entries.set(key, entry);
  setTimeout(() => { if (entries.get(key) === entry) entries.delete(key); }, TTL);
  entry.promise.catch(() => { if (entries.get(key) === entry) entries.delete(key); });
}
function take(key, loader) {
  const entry = entries.get(key);
  entries.delete(key);
  if (entry && entry.owner === identity() && Date.now() < entry.expires) return entry.promise;
  return loader();
}
function schedule() {
  if (!identity()) return;
  const owner = identity();
  if (scheduledOwner === owner) return;
  scheduledOwner = owner;
  const api = require('./career');
  const c = require('../utils/career');
  const day = c.dateParts().date;
  preload('profile', () => require('./account').getProfile());
  preload('applications', () => api.listApplications({ scope: 'active', limit: 100 }));
  preload('sessions:' + day, () => api.listSessions({
    startAt: c.iso(day, '00:00'), endAt: c.iso(c.shiftDate(day, 1), '00:00'), limit: 100,
  }));
}
module.exports = { schedule, take, preload };
