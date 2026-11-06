import * as SecureStore from 'expo-secure-store';

// ===== CONFIG =====
// Set EXPO_PUBLIC_API_URL in .env (use your PC's LAN IP on a real phone)
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

// ===== AUTH (login / refresh / logout) =====

const KEYS = { token: 'token', refresh: 'refresh_token', user: 'user' };

export async function saveSession(user, token, refreshToken) {
  await SecureStore.setItemAsync(KEYS.user, JSON.stringify(user));
  await SecureStore.setItemAsync(KEYS.token, token);
  if (refreshToken) await SecureStore.setItemAsync(KEYS.refresh, refreshToken);
}

export async function getStoredUser() {
  const raw = await SecureStore.getItemAsync(KEYS.user);
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

export async function clearSession() {
  await Promise.all(Object.values(KEYS).map((k) => SecureStore.deleteItemAsync(k)));
}

// Same endpoint as the web app: POST /api/login { email, password }
// Response: { success, message, user, token, refresh_token }
export async function login(email, password) {
  let res;
  try {
    res = await fetch(`${API_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    throw new Error('Cannot reach server. Check your internet or API URL.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.message || 'Login failed');
  await saveSession(data.user, data.token, data.refresh_token);
  return data.user;
}

// POST /api/refresh { refresh_token } -> { success, token }
export async function refreshAccessToken() {
  const refresh_token = await SecureStore.getItemAsync(KEYS.refresh);
  if (!refresh_token) return false;
  try {
    const res = await fetch(`${API_URL}/api/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) { await clearSession(); return false; }
    await SecureStore.setItemAsync(KEYS.token, data.token);
    return true;
  } catch { return false; }
}

// fetch wrapper: adds Bearer token, refreshes once on 401 and retries.
export async function authFetch(path, opts = {}) {
  const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;
  const call = async () => {
    const token = await SecureStore.getItemAsync(KEYS.token);
    return fetch(`${API_URL}${path}`, {
      ...opts,
      headers: { ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...(opts.headers || {}), Authorization: token ? `Bearer ${token}` : '' },
    });
  };
  let res = await call();
  if (res.status === 401 && (await refreshAccessToken())) res = await call();
  return res;
}

// POST /api/logout { refresh_token } revokes the session on the server.
export async function logout() {
  const refresh_token = await SecureStore.getItemAsync(KEYS.refresh);
  const token = await SecureStore.getItemAsync(KEYS.token);
  try {
    await fetch(`${API_URL}/api/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' },
      body: JSON.stringify({ refresh_token }),
    });
  } catch {}
  await clearSession();
}

// ===== ADD MORE APIs BELOW (dashboard, curriculum, schools...) using authFetch =====


// ===== ROLES (same ids as backend roles table) =====
export const ROLES = {
  1: 'Administrator', 2: 'Operations Head', 3: 'SSGM', 4: 'Head Coach',
  5: 'Coach', 6: 'HR', 7: 'Admin', 8: 'Principal',
};

// ===== DASHBOARD =====
// GET /api/dashboard/stats?user_id= -> { students, schools, staff, lectures, weekly_reports, mir_reports }
// Backend filters by the user's assigned schools (roles 1, 2, 7 see everything).
export async function getDashboardStats(userId) {
  const res = await authFetch(`/api/dashboard/stats?user_id=${userId}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.message || 'Failed to load dashboard');
  return data.data;
}

// GET /api/schools?user_id=&role_id= -> schools visible to this user
export async function getSchools(user) {
  const res = await authFetch(`/api/schools?user_id=${user.id}&role_id=${user.role_id}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('Failed to load schools');
  return data.schools || [];
}

// Builds a full URL for files served from /uploads (or passes through absolute URLs)
export function fileUrl(p) {
  if (!p) return null;
  if (/^https?:\/\//.test(p)) return p;
  const clean = String(p).replace(/^\/+/, '').replace(/^uploads\//, '');
  return `${API_URL}/uploads/${clean}`;
}

async function getJson(path, errMsg) {
  let res;
  try { res = await authFetch(path); } catch { throw new Error('Cannot reach server.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.message || errMsg);
  return data;
}

async function sendJson(path, body, errMsg, method = 'POST') {
  let res;
  try {
    res = await authFetch(path, { method, body: body instanceof FormData ? body : JSON.stringify(body) });
  } catch { throw new Error('Cannot reach server.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.message || errMsg);
  return data;
}

// ===== DASHBOARD FEED (same as web DefaultDashboard widgets) =====
// GET /api/dashboard/highlights?user_id=&role_id= -> { data: [{ id, title, tagline, subtitle, image_path, reel_url, category, school_name }] }
export async function getHighlights(user) {
  const d = await getJson(`/api/dashboard/highlights?user_id=${user.id}&role_id=${user.role_id}`, 'Failed to load highlights');
  return (d.data || []).filter((h) => h.is_active === undefined || Number(h.is_active) === 1);
}
// GET /api/dashboard/events?user_id=&role_id= -> { data: [{ id, title, event_date, category, school_id }] }
export async function getEvents(user) {
  const d = await getJson(`/api/dashboard/events?user_id=${user.id}&role_id=${user.role_id}`, 'Failed to load events');
  return d.data || [];
}
// GET /api/dashboard/content-feed?user_id= -> { data: { videos: [], photos: [] } }
export async function getContentFeed(user) {
  const d = await getJson(`/api/dashboard/content-feed?user_id=${user.id}`, 'Failed to load content');
  return d.data || { videos: [], photos: [] };
}

// ===== GALLERY =====
// GET /api/schools?hasGallery=true&user_id= -> { schools: [{ id, name, gallery_count, school_image, school_logo }] }
export async function getGallerySchools(user) {
  const d = await getJson(`/api/schools?hasGallery=true&user_id=${user.id}&role_id=${user.role_id}`, 'Failed to load galleries');
  return d.schools || [];
}
// GET /api/schools/:id -> { school }
export async function getSchool(id) {
  const d = await getJson(`/api/schools/${id}`, 'Failed to load school');
  return d.school;
}
// GET /api/school-gallery/:schoolId -> { gallery: [{ id, file_path, file_type, category, description, uploaded_at }] }
export async function getSchoolGallery(schoolId) {
  const d = await getJson(`/api/school-gallery/${schoolId}`, 'Failed to load photos');
  return d.gallery || [];
}

// ===== ACHIEVEMENTS =====
// GET /api/school-achievements?user_id= (mine) | ?exclude_user_id= (others)
// -> { data: [{ id, title, description, schoolId, schoolName, createdAt, media: [{ type, url }] }] }
export async function getAchievements(user, mine = true) {
  const q = mine ? `user_id=${user.id}` : `exclude_user_id=${user.id}`;
  const d = await getJson(`/api/school-achievements?${q}`, 'Failed to load achievements');
  return d.data || [];
}
// POST /api/school-achievements (multipart: title, description, user_id, school_id, media[])
// POST /api/school-achievements multipart { title, description, user_id, school_id, media[] (max 10) }
export async function createAchievement(user, { title, description, school_id, media = [] }) {
  const build = () => {
    const fd = new FormData();
    fd.append('title', title);
    fd.append('description', description || '');
    fd.append('user_id', String(user.id));
    if (school_id) fd.append('school_id', String(school_id));
    media.slice(0, 10).forEach((a, i) => fd.append('media', filePart(a, i)));
    return fd;
  };
  return postMultipart('/api/school-achievements', build, 'Failed to save achievement');
}
// ===== CURRICULUM (MyCurriculumPage) =====
// GET /api/curriculum/my-assignments/:userId -> { assignments: [{ id, sport, id_indicate_curriculum, module_count, created_at }] }
export async function getMyCurriculums(userId) {
  const d = await getJson(`/api/curriculum/my-assignments/${userId}`, 'Failed to load curriculums');
  return d.assignments || [];
}
// GET /api/curriculum/my-modules/:userId -> { modules: [{ module_id, sport, grade, skill, sub_skill, objective, lp_no }] }
export async function getMyModules(userId) {
  const d = await getJson(`/api/curriculum/my-modules/${userId}`, 'Failed to load modules');
  return d.modules || [];
}
// GET /api/curriculum/my-lp-summary/:userId -> { grouped: { month: { key: { school_name, week_no, items[] } } }, schools, totalCount }
export async function getMyLpSummary(userId) {
  return getJson(`/api/curriculum/my-lp-summary/${userId}`, 'Failed to load lesson plans');
}

// ===== HELPDESK =====
// GET /api/support/feedback -> { data: [{ id, user_id, name, email, subject, message, created_at }] } (filtered to me client-side)
export async function getMyFeedback(user) {
  const d = await getJson('/api/support/feedback', 'Failed to load tickets');
  return (d.data || []).filter((f) => String(f.user_id) === String(user.id));
}
// POST /api/support/feedback { subject, message, name, email, user_id }
export function sendFeedback(user, { subject, message }) {
  return sendJson('/api/support/feedback', { subject, message, name: user.name, email: user.email, user_id: user.id }, 'Failed to send feedback');
}
// POST /api/support/ticket { school_id, subject, name, email, message, user_id } (RaiseTicketCard / SupportDetailsModal)
export function raiseTicket(user, { school_id, subject, message }) {
  return sendJson('/api/support/ticket', { school_id: school_id || '', subject, name: user.name, email: user.email, message, user_id: user.id }, 'Failed to raise ticket');
}
// ===== ACHIEVEMENT SOCIAL (likes / comments / saves stored in backend) =====
async function jsonOrThrow(res, fallback) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.message || fallback);
  return data;
}
const listOf = (d) => d.data || d.achievements || d.items || (Array.isArray(d) ? d : []);

export async function getAchievementFeed() {
  return listOf(await jsonOrThrow(await authFetch('/api/school-achievements/feed'), 'Failed to load achievements'));
}
export async function getSavedAchievements() {
  return listOf(await jsonOrThrow(await authFetch('/api/school-achievements/saved'), 'Failed to load saved'));
}
export async function toggleAchievementLike(id) {
  return jsonOrThrow(await authFetch(`/api/school-achievements/${id}/like`, { method: 'POST' }), 'Like failed');
}
export async function toggleAchievementSave(id) {
  return jsonOrThrow(await authFetch(`/api/school-achievements/${id}/save`, { method: 'POST' }), 'Save failed');
}
export async function getAchievementComments(id) {
  const d = await jsonOrThrow(await authFetch(`/api/school-achievements/${id}/comments`), 'Failed to load comments');
  return d.comments || d.data || [];
}
export async function postAchievementComment(id, comment) {
  return jsonOrThrow(await authFetch(`/api/school-achievements/${id}/comments`, { method: 'POST', body: JSON.stringify({ comment }) }), 'Comment failed');
}

// ===== MULTIPART UPLOADS (XMLHttpRequest: RN's XHR handles { uri, name, type } file parts reliably) =====
function filePart(a, i) {
  const isVid = a.type === 'video';
  const ext = (a.fileName && a.fileName.split('.').pop()) || (isVid ? 'mp4' : 'jpg');
  return { uri: a.uri, name: a.fileName || `media_${Date.now()}_${i}.${ext}`, type: a.mimeType || (isVid ? 'video/mp4' : 'image/jpeg') };
}
function xhrUpload(path, form, token) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}${path}`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.timeout = 180000;
    xhr.onload = () => { let d = {}; try { d = JSON.parse(xhr.responseText); } catch {} resolve({ status: xhr.status, data: d }); };
    xhr.onerror = () => reject(new Error('Network error while uploading. Check the server is running.'));
    xhr.ontimeout = () => reject(new Error('Upload timed out.'));
    xhr.send(form);
  });
}
async function postMultipart(path, buildForm, fallback) {
  let r = await xhrUpload(path, buildForm(), await SecureStore.getItemAsync(KEYS.token));
  if (r.status === 401 && (await refreshAccessToken())) r = await xhrUpload(path, buildForm(), await SecureStore.getItemAsync(KEYS.token));
  if (r.status < 200 || r.status >= 300 || r.data.success === false) throw new Error(r.data.message || `${fallback} (${r.status})`);
  return r.data;
}
// POST /api/school-gallery/:schoolId multipart { photos[], category } -> uploads to an event album
export function uploadGalleryPhotos(schoolId, assets, category) {
  return postMultipart(`/api/school-gallery/${schoolId}`, () => {
    const form = new FormData();
    assets.forEach((a, i) => form.append('photos', filePart(a, i)));
    form.append('category', category);
    return form;
  }, 'Upload failed');
}

// ===== MQ CURRICULUM (same flow as web SelectCurriculumPage: program -> school -> sport -> grade -> lesson plans) =====
// program: 'inschool' | 'sdp' | 'msfc'
const qs = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

// inschool: GET /api/curriculum/school-sports?school_id= | sdp/msfc: GET /api/curriculum/{sdp|msfc}/sports -> { sports: [] }
export async function getCurriculumSports(program, schoolId) {
  const path = program === 'inschool' ? `/api/curriculum/school-sports?${qs({ school_id: schoolId })}` : `/api/curriculum/${program}/sports`;
  const d = await getJson(path, 'Failed to load sports');
  return (d.sports || []).map((s) => String(s).trim()).filter(Boolean);
}
// inschool: GET /api/curriculum/school-grades?school_id=&sport= -> { grades } (only grades that have lesson plans)
// Without a sport (Extra Covered screen), keep the school's full standards list.
// sdp/msfc: GET /api/curriculum/{p}/grades/:sport -> { grades }
export async function getCurriculumGrades(program, sport, schoolId) {
  if (program === 'inschool') {
    if (!sport) {
      const d = await getJson(`/api/students/standards?${qs({ school_id: schoolId })}`, 'Failed to load grades');
      return d.standards || [];
    }
    const d = await getJson(`/api/curriculum/school-grades?${qs({ school_id: schoolId, sport })}`, 'Failed to load grades');
    return d.grades || [];
  }
  const d = await getJson(`/api/curriculum/${program}/grades/${encodeURIComponent(sport)}`, 'Failed to load groups');
  return d.grades || [];
}
// GET /api/curriculum/grade-level-map?school_id=&sport= -> { map, school_grade_map } (school grade -> curriculum level)
export async function getGradeLevelMap(schoolId, sport) {
  const d = await getJson(`/api/curriculum/grade-level-map?${qs({ school_id: schoolId, sport })}`, 'Failed to load grade map');
  return { map: d.map || {}, school_grade_map: d.school_grade_map || {} };
}
// GET /api/students/divisions?school_id=&stds= -> { divisions }
export async function getSchoolDivisions(schoolId, stds) {
  const d = await getJson(`/api/students/divisions?${qs({ school_id: schoolId, stds })}`, 'Failed to load divisions');
  return d.divisions || [];
}
// GET /api/curriculum/{,sdp/,msfc/}sport-lesson-plans?school_id=&sport=&grade=&school_grade= -> { lesson_plans }
export async function getSportLessonPlans(program, { schoolId, sport, grade, schoolGrade }) {
  const base = program === 'inschool' ? '/api/curriculum/sport-lesson-plans' : `/api/curriculum/${program}/sport-lesson-plans`;
  const d = await getJson(`${base}?${qs({ school_id: schoolId, sport, grade, school_grade: schoolGrade })}`, 'Failed to load lesson plans');
  return d.lesson_plans || [];
}
// GET /api/curriculum/check-done?lp_unique_id=&school_id=&divisions=&grade= -> { isDone, lessonStatus, hasAnyHistory, record }
export async function checkLessonDone({ lpId, schoolId, divisions = '', grade = '' }) {
  return getJson(`/api/curriculum/check-done?${qs({ lp_unique_id: lpId, school_id: schoolId, divisions, grade })}`, 'Failed to check status');
}
// GET /api/curriculum/lesson-history?lp_unique_id=&school_id=&divisions=&grade= -> { history: [{ status, remark, evidence_photo, divisions, grade, created_at }] }
export async function getLessonHistory({ lpId, schoolId, divisions = '', grade = '' }) {
  const d = await getJson(`/api/curriculum/lesson-history?${qs({ lp_unique_id: lpId, school_id: schoolId, divisions, grade })}`, 'Failed to load history');
  return d.history || [];
}
// POST /api/curriculum/save-lp-status multipart { lp_no, lp_unique_id, sport, grade, user_id, status, remark, school_id, divisions, week_no, month_year, photos[] (max 10) }
export function saveLessonStatus(user, f, photos = []) {
  return postMultipart('/api/curriculum/save-lp-status', () => {
    const fd = new FormData();
    const fields = { lp_no: f.lp_no, lp_unique_id: f.lp_unique_id, sport: f.sport, grade: f.grade, user_id: user.id, status: f.status, remark: f.remark || '', school_id: f.school_id, divisions: f.divisions, week_no: f.week_no, month_year: f.month_year };
    Object.entries(fields).forEach(([k, v]) => { if (v !== undefined && v !== null) fd.append(k, String(v)); });
    photos.slice(0, 10).forEach((a, i) => fd.append('photos', filePart(a, i)));
    return fd;
  }, 'Failed to save status');
}

// ===== EXTRA COVERED (web "Extra Covered" card -> Log Extra Activity) =====
// POST /api/curriculum/save-extra-activity multipart { title, sport, covered_skill, objective, school_id, grade, divisions, remark, week, month_year, activity_type: 'extra', user_id, photos[] (max 10) }
// Saved into coach_lesson_tracking as Complete (lp_no "0"), shows in the Weekly Report Card.
export function saveExtraActivity(user, f, photos = []) {
  return postMultipart('/api/curriculum/save-extra-activity', () => {
    const fd = new FormData();
    const fields = { title: f.title, sport: f.sport, covered_skill: f.covered_skill, objective: f.objective, school_id: f.school_id, grade: f.grade, divisions: f.divisions, remark: f.remark, week: f.week, month_year: f.month_year, activity_type: 'extra', user_id: user.id };
    Object.entries(fields).forEach(([k, v]) => { if (v !== undefined && v !== null) fd.append(k, String(v)); });
    photos.slice(0, 10).forEach((a, i) => fd.append('photos', filePart(a, i)));
    return fd;
  }, 'Failed to log activity');
}
// ===== TEAM MANAGEMENT ('teams') & SDP ('sports-teams') =====
// kind: 'teams' | 'sports-teams'. Server filters role 4/5 to teams where coach_id = self.
// GET /api/{kind}?user_id=&role_id= -> { teams } | { sportsTeams }
export async function getTeams(kind, user) {
  const d = await getJson(`/api/${kind}?user_id=${user.id}&role_id=${user.role_id}`, 'Failed to load teams');
  return d.teams || d.sportsTeams || [];
}
// GET /api/{kind}/:id/players -> { players: [{ id, name, std, division, gender }] }
export async function getTeamPlayers(kind, id) {
  const d = await getJson(`/api/${kind}/${id}/players`, 'Failed to load players');
  return d.players || [];
}
// POST /api/{kind} { name, sport, school_id, coach_id, description, status, roster: [] } -> { id }
export function createTeam(kind, t) {
  return sendJson(`/api/${kind}`, { ...t, status: t.status || 'Preparation', roster: [] }, 'Failed to create team');
}
// PUT /api/{kind}/:id { name, sport, school_id, coach_id, description, status }
export function updateTeam(kind, id, t) {
  return sendJson(`/api/${kind}/${id}`, { name: t.name, sport: t.sport, school_id: t.school_id, coach_id: t.coach_id, description: t.description || '', status: t.status || 'Preparation' }, 'Failed to update team', 'PUT');
}
// DELETE /api/{kind}/:id (SDP also removes players + attendance)
export function deleteTeam(kind, id) {
  return sendJson(`/api/${kind}/${id}`, {}, 'Failed to delete team', 'DELETE');
}
// POST /api/{kind}/:id/attach-players { student_ids } -> { added } (existing school students, no Excel)
export function attachPlayers(kind, id, studentIds) {
  return sendJson(`/api/${kind}/${id}/attach-players`, { student_ids: studentIds }, 'Failed to add players');
}
// DELETE /api/{kind}/:id/players/:studentId
export function removePlayer(kind, id, studentId) {
  return sendJson(`/api/${kind}/${id}/players/${studentId}`, {}, 'Failed to remove player', 'DELETE');
}
// GET /api/school-students?school_id= -> { students: [{ id, name, std, division, gender }] }
export async function getSchoolStudents(schoolId) {
  const d = await getJson(`/api/school-students?school_id=${schoolId}`, 'Failed to load students');
  return d.students || [];
}
// GET /api/current-date -> { date: 'YYYY-MM-DD' } (server local date, same as web)
export async function getServerDate() {
  try { const d = await getJson('/api/current-date', ''); return d.date; } catch { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; }
}
// GET /api/sports-teams/:id/attendance?date= -> { attendance: [{ student_id, status }] }
export async function getAttendance(teamId, date) {
  const d = await getJson(`/api/sports-teams/${teamId}/attendance?date=${date}`, 'Failed to load attendance');
  return d.attendance || [];
}
// POST /api/sports-teams/:id/attendance { attendance_date, attendance: [{ student_id, status: 'present'|'absent' }] } (upsert)
export function saveAttendance(teamId, date, attendance) {
  return sendJson(`/api/sports-teams/${teamId}/attendance`, { attendance_date: date, attendance }, 'Failed to save attendance');
}
// GET /api/sports-teams/attendance-status?team_ids=&date= -> { status: { teamId: markedCount } }
export async function getAttendanceStatus(teamIds, date) {
  if (!teamIds.length) return {};
  const d = await getJson(`/api/sports-teams/attendance-status?team_ids=${teamIds.join(',')}&date=${date}`, 'Failed to load status');
  return d.status || {};
}
// GET /api/sports-teams/:id/attendance-summary?from=&to= -> { days: [{ date, present, absent }] }
export async function getAttendanceSummary(teamId, from, to) {
  const d = await getJson(`/api/sports-teams/${teamId}/attendance-summary?from=${from}&to=${to}`, 'Failed to load history');
  return d.days || [];
}
// ===== STUDENTS (web StudentsListPage) =====
// GET /api/students?user_id= -> { students: [{ id, mq_id, name, gender, school_id, school_name, std, division, roll_number, status }] } (scoped to assigned schools)
export async function getStudents(user) {
  const d = await getJson(`/api/students?user_id=${user.id}`, 'Failed to load students');
  return d.students || (Array.isArray(d) ? d : []);
}
// POST /api/students { name, gender, school_name, standard, division, gr_number, mq_id, status }
export function createStudent(f) {
  return sendJson('/api/students', { ...f, roll_number: f.gr_number, status: 1 }, 'Failed to add student');
}
// PUT /api/students/:id { name, gender, school_name, standard, division, gr_number, mq_id, status: 'Active'|'Inactive' }
export function updateStudent(id, f) {
  return sendJson(`/api/students/${id}`, f, 'Failed to update student', 'PUT');
}
// DELETE /api/students/:id
export function deleteStudent(id) {
  return sendJson(`/api/students/${id}`, {}, 'Failed to delete student', 'DELETE');
}
// ===== LECTURE ATTENDANCE (web: /management/lectures/mark + /student/attendance) =====
// GET /api/management/lecture-metadata?user_id= -> { schools: [{ id, name }] }
export async function getLectureSchools(user) {
  const d = await getJson(`/api/management/lecture-metadata?user_id=${user.id}`, 'Failed to load schools');
  return d.schools || [];
}
// POST /api/management/lectures { school_id, coach_id, user_id, sport, lecture_date, start_time, end_time, grades[], division[], week_no }
export function markLecture(user, f) {
  return sendJson('/api/management/lectures', { ...f, coach_id: user.id, user_id: user.id, grades: [f.grade], division: [f.division || ''] }, 'Failed to save lecture');
}
// GET /api/student-attendance?date=&user_id=&role_id=&school_name= -> { records: [{ mq_id, student_name, standard, division, status }] }
export async function getStudentAttendance(user, date, schoolName) {
  const d = await getJson(`/api/student-attendance?${qs({ date, user_id: user.id, role_id: user.role_id, school_name: schoolName, _: Date.now() })}`, 'Failed to load attendance');
  return d.records || [];
}
// POST /api/student-attendance/upload { attendance: [{ mq_id, student_name, standard, division, school_name, attendance_date, status: 'present'|'absent' }], uploaded_by }
export function saveStudentAttendance(user, rows) {
  return sendJson('/api/student-attendance/upload', { attendance: rows, uploaded_by: user.id }, 'Failed to save attendance');
}

// ===== FILL MARKS (web: /exams/fill-marks) =====
// GET /api/fill-marks/filters?school_id=&user_id= -> { filters: { schools, standards: [{ id, name }], divisions: [], terms } }
export async function getFillMarksFilters(user, schoolId) {
  const d = await getJson(`/api/fill-marks/filters?${qs({ school_id: schoolId, user_id: user.id })}`, 'Failed to load filters');
  return d.filters || { schools: [], standards: [], divisions: [], terms: ['Term 1', 'Term 2'] };
}
// GET /api/exam-formats?school_id=&user_id= -> { formats: [{ id, test_name, test_title }] } (formats assigned to the school)
export async function getExamFormats(user, schoolId) {
  const d = await getJson(`/api/exam-formats?${qs({ school_id: schoolId, user_id: user.id })}`, 'Failed to load tests');
  return d.formats || [];
}
// GET /api/fill-marks/format/:id -> { parameters: [{ id, title, ctype, test_display, is_required }] }
export async function getFormatParams(formatId) {
  const d = await getJson(`/api/fill-marks/format/${formatId}`, 'Failed to load test parameters');
  return d.parameters || [];
}
// GET /api/fill-marks/students?school_id&std&division&format_id&term -> { students: [{ id, name, mq_id, gender, marks: { [paramId]: value } }], ranges }
export async function getFillMarksStudents(q) {
  const d = await getJson(`/api/fill-marks/students?${qs(q)}`, 'Failed to load students');
  return { students: d.students || [], ranges: d.ranges || [] };
}
// POST /api/fill-marks/save { format_id, school_id, std, division, term, entry_mode: 'division', examiner_name: '', marks: [{ student_id, parameter_id, value }] }
export function saveFillMarks(body) {
  return sendJson('/api/fill-marks/save', { entry_mode: 'division', examiner_name: '', ...body }, 'Failed to save marks');
}
// Printable sheet (HTML, print / save as PDF from the browser): GET /api/fill-marks/template?...
export const fillMarksTemplateUrl = (q) => `${API_URL}/api/fill-marks/template?${qs(q)}`;
// POST /api/fill-marks/scan multipart { photo, school_id, std, division, format_id, term } -> { marks: [{ student_id, parameter_id, value, confidence }], unmatched, engine }
export function scanMarksSheet(q, asset) {
  return postMultipart('/api/fill-marks/scan', () => {
    const form = new FormData();
    form.append('photo', filePart({ ...asset, type: 'image' }, 0));
    Object.entries(q).forEach(([k, v]) => form.append(k, String(v)));
    return form;
  }, 'Could not read the photo');
}

// ===== WEEKLY REPORT (web: /curriculum/weekly-report) =====
// GET /api/schools?user_id=&hasReports=true -> { schools: [{ id, name }] }
export async function getReportSchools(user) {
  const d = await getJson(`/api/schools?user_id=${user.id}&hasReports=true`, 'Failed to load schools');
  return d.schools || [];
}
// GET /api/curriculum/report-filters/:schoolId -> { filters: { 'Oct,2026': ['Week 3', ...] }, week_ranges, week_statuses }
export async function getReportFilters(schoolId) {
  const d = await getJson(`/api/curriculum/report-filters/${schoolId}`, 'Failed to load weeks');
  return { filters: d.filters || {}, ranges: d.week_ranges || {}, statuses: d.week_statuses || {} };
}
// GET /api/curriculum/report-data?school_id&month_year&week_no -> { report: { summary, all_sessions, sports_reports, is_published, ... } }
export async function getReportData(schoolId, monthYear, weekNo) {
  const d = await getJson(`/api/curriculum/report-data?${qs({ school_id: schoolId, month_year: monthYear, week_no: weekNo })}`, 'Failed to load report');
  return d.report || null;
}
// POST /api/curriculum/publish-report { school_id, user_id, month_year, week_no, email, school_name } (marks the week published + emails the principal)
export function publishWeeklyReport(user, f) {
  return sendJson('/api/curriculum/publish-report', { ...f, user_id: user.id }, 'Failed to publish report');
}
// Designed weekly report card PDF (same layout as MQ-Coach-App web html2pdf).
export function weeklyReportPdfUrl({ schoolId, monthYear, weekNo }) {
  return `${API_URL}/api/curriculum/weekly-report-pdf?${qs({ school_id: schoolId, month_year: monthYear, week_no: weekNo })}`;
}

export async function fetchWeeklyReportPdfBase64({ schoolId, monthYear, weekNo }) {
  const url = `${API_URL}/api/curriculum/weekly-report-pdf?${qs({ school_id: schoolId, month_year: monthYear, week_no: weekNo, format: 'base64' })}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success || !data.pdf_base64) {
    throw new Error(data?.message || 'Failed to generate weekly report PDF');
  }
  return data;
}


// ===== REPORT CARDS (web: /reports/report-card) =====
// GET /api/reports/students?school_id&std&division&limit -> { students: [{ id, name, mq_id, std, division, result_id }], total } (only students with marks)
export async function getReportStudents(q) {
  const d = await getJson(`/api/reports/students?${qs({ limit: 10000, offset: 0, ...q })}`, 'Failed to load students');
  return d.students || [];
}
// GET /api/reports/check?ids= -> { results: { [resultId]: { ready, out_of_range, missing, items } } } (read-only)
export async function checkReportCards(ids) {
  if (!ids.length) return {};
  const d = await getJson(`/api/reports/check?ids=${ids.join(',')}`, 'Failed to check marks');
  return d.results || {};
}
// GET /api/reports/data/:resultId -> { student, results: [{ title, parameter_value, mark_status, grade }] }
export async function getReportPreview(resultId) {
  return getJson(`/api/reports/data/${resultId}`, 'Failed to load preview');
}
// POST /api/reports/generate-pdf { result_id, options: { selectedTerm, showScanner } } -> { success } or { success:false, outOfRange }
export async function generateReportCard(resultId, options) {
  let res;
  try { res = await authFetch('/api/reports/generate-pdf', { method: 'POST', body: JSON.stringify({ result_id: resultId, options }) }); } catch { throw new Error('Cannot reach server.'); }
  return res.json().catch(() => ({ success: false, message: 'Generate failed' }));
}
// PDF links (open in the browser to view / share / download)
export const reportCardPdfUrl = (resultId, options) => `${API_URL}/api/reports/download-single/${resultId}?overrides=${encodeURIComponent(JSON.stringify(options))}`;
export const reportCardZipUrl = (ids, options) => `${API_URL}/api/reports/download-zip?ids=${encodeURIComponent(ids.join(','))}&overrides=${encodeURIComponent(JSON.stringify(options))}`;
export const detailReportPdfUrl = (resultId) => `${API_URL}/api/reports/detail-pdf/${resultId}`;


// ===== EQUIPMENT: shared school counts + append-only movements =====
export const getEquipmentSchools = async () => (await getJson('/api/school-inventory/schools', 'Could not load schools')).schools || [];
export const getEquipmentStock = schoolId => getJson(`/api/equipment/current?${qs({school_id:schoolId})}`, 'Could not load stock');
export const getEquipmentRecipients = schoolId => getJson(`/api/equipment/recipients?${qs({school_id:schoolId})}`, 'Could not load people');
export const getEquipmentLoans = async schoolId => (await getJson(`/api/equipment/loans?${qs({school_id:schoolId})}`, 'Could not load loans')).loans || [];
export const getEquipmentMovements = (schoolId,before) => getJson(`/api/equipment/movements?${qs({school_id:schoolId,...(before?{before}:{})})}`, 'Could not load activity');
export const getEquipmentRequests = async schoolId => (await getJson(`/api/equipment-orders?${qs({school_id:schoolId})}`, 'Could not load requests')).orders || [];
export const saveEquipmentMovement = fields => sendJson('/api/equipment/movements', fields, 'Could not update stock');
export const retryEquipmentMissing = id => sendJson(`/api/equipment/movements/${id}/retry`, {}, 'Could not retry this report');
export const requestEquipment = (fields,photo) => postMultipart('/api/equipment-orders', () => {
  const form = new FormData();
  Object.entries(fields).forEach(([k,v])=>form.append(k, typeof v==='object'?JSON.stringify(v):String(v)));
  if(photo) form.append('image',filePart({...photo,type:'image'},0));
  return form;
}, 'Could not request equipment');

// Match screens already exist; keep their feature wiring intact.
export async function getMatchReports(){return (await getJson('/api/match-reports','Could not load matches')).reports||[];}
export async function getMatchReport(id){return (await getJson('/api/match-reports/'+id,'Could not load match')).report;}
export const getMatchOptions=schoolId=>getJson('/api/match-reports/options?'+qs({school_id:schoolId}),'Could not load match choices');
export async function matchReportPdfUrl(id){return API_URL+(await getJson('/api/match-reports/'+id+'/pdf-link','Could not open PDF')).path;}
export function saveMatchReport(id,fields,photos=[],pdf){return postMultipart(id?'/api/match-reports/'+id+'/edit':'/api/match-reports',()=>{const form=new FormData();Object.entries(fields).forEach(([k,v])=>{if(v!==undefined&&v!==null)form.append(k,Array.isArray(v)?JSON.stringify(v):String(v));});photos.forEach((p,i)=>form.append('photos',filePart({...p,type:'image'},i)));if(pdf)form.append('report',{uri:pdf.uri,name:pdf.name||'match-report.pdf',type:'application/pdf'});return form;},'Could not save match');}
