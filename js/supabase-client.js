/* js/supabase-client.js
 * Shared Supabase client + auth helpers for route.html / admin.html.
 * Include AFTER the Supabase JS SDK script tag:
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
 *   <script src="js/supabase-client.js"></script>
 *
 * Fill in the two constants below after creating your Supabase project
 * (SETUP-GUIDE.md step 1). Both are PUBLIC values — safe to ship in client
 * code — never put the service_role key here.
 */
'use strict';

const SUPABASE_URL = 'https://tnvzeahfugmmrydtnsdv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRudnplYWhmdWdtbXJ5ZHRuc2R2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM1NDUyNjksImV4cCI6MjA5OTEyMTI2OX0.r10_gbLUpB6XgIbZa7IO94vJ4LON3BGQF5J473EizLQ';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ---------- Auth ---------- */

/** Redirect the browser to Google sign-in. After success, Supabase redirects
 *  back to `redirectTo` (defaults to the current page). */
async function signInWithGoogle(redirectTo) {
  await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: redirectTo || window.location.href }
  });
}

async function signOut() {
  await sb.auth.signOut();
  window.location.reload();
}

/** Current logged-in user (or null). */
async function getUser() {
  const { data } = await sb.auth.getUser();
  return data?.user || null;
}

/** Upload a photo to flood_photos bucket and return the public URL */
async function uploadFloodPhoto(file) {
  if (!file) return null;
  const ext = file.name.split('.').pop();
  const fileName = `${Date.now()}_${Math.random().toString(36).substring(2)}.${ext}`;
  const { data, error } = await sb.storage.from('flood_photos').upload(fileName, file, { upsert: false });
  if (error) { console.error('Upload error:', error); throw error; }
  const { data: pubData } = sb.storage.from('flood_photos').getPublicUrl(fileName);
  return pubData.publicUrl;
}

/** Current user's row in public.profiles (or null if signed out). */
async function getProfile() {
  const user = await getUser();
  if (!user) return null;
  const { data, error } = await sb
    .from('profiles')
    .select('id, email, full_name, phone, role, status, created_at, province_scope')
    .eq('id', user.id)
    .single();
  if (error) { console.error('getProfile error:', error); return null; }
  return data;
}

/**
 * Wires up a standard auth-state UI. Call once per page.
 * @param {{
 *   onSignedOut: () => void,
 *   onPending: (profile) => void,
 *   onRejected: (profile) => void,
 *   onApproved: (profile) => void,
 *   onAdmin: (profile) => void   // called instead of onApproved when role==='admin'
 * }} handlers
 */
function watchAuthState(handlers) {
  async function evaluate() {
    const profile = await getProfile();
    if (!profile) { handlers.onSignedOut && handlers.onSignedOut(); return; }
    if (profile.status === 'rejected') { handlers.onRejected && handlers.onRejected(profile); return; }
    if (profile.status === 'pending') { handlers.onPending && handlers.onPending(profile); return; }
    if (profile.role === 'admin' && handlers.onAdmin) { handlers.onAdmin(profile); return; }
    handlers.onApproved && handlers.onApproved(profile);
  }
  sb.auth.onAuthStateChange(() => evaluate());
  evaluate();
}

/* ---------- Vehicle types shared by route.html ---------- */
const VEHICLE_TYPES = [
  { id: 'motorcycle',  label: 'มอเตอร์ไซค์',      icon: '🏍️', safeDepthCm: 10 },
  { id: 'sedan',       label: 'รถเก๋ง',           icon: '🚗', safeDepthCm: 15 },
  { id: 'pickup_suv',  label: 'กระบะ / SUV',      icon: '🚙', safeDepthCm: 30 },
  { id: 'small_truck', label: 'รถบรรทุกเล็ก',     icon: '🚚', safeDepthCm: 50 },
  { id: 'big_truck',   label: 'รถบรรทุกใหญ่',     icon: '🚛', safeDepthCm: 70 }
];
