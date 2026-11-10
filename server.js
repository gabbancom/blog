const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'GBT@135#';

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'public', 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, uniqueSuffix + ext);
  }
});
const upload = multer({ storage });

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// Admin Login
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    return res.json({ success: true, token: 'session_auth_token_secret' });
  }
  return res.status(401).json({ success: false, message: 'كلمة المرور غير صحيحة' });
});

// Single Upload (Images / Docs)
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'لم يتم رفع ملف' });
  res.json({ url: `/uploads/${req.file.filename}`, filename: req.file.originalname, size: req.file.size });
});

// Dual Upload for Books
app.post('/api/upload-book', upload.fields([{ name: 'docFile', maxCount: 1 }, { name: 'coverFile', maxCount: 1 }]), (req, res) => {
  const docUrl = req.files && req.files['docFile'] ? `/uploads/${req.files['docFile'][0].filename}` : null;
  const coverUrl = req.files && req.files['coverFile'] ? `/uploads/${req.files['coverFile'][0].filename}` : null;
  res.json({ docUrl, coverUrl });
});

// Full Backup Zip Endpoint (One-Click Backup)
app.get('/api/admin/backup', (req, res) => {
  const token = req.query.token;
  if (token !== 'session_auth_token_secret') {
    return res.status(403).send('غير مصرح بتنزيل النسخة الاحتياطية');
  }

  let archiver;
  try {
    archiver = require('archiver');
    const archive = archiver('zip', { zlib: { level: 9 } });
    res.attachment(`ghabban_blog_backup_${Date.now()}.zip`);
    archive.pipe(res);

    const contentDir = path.join(__dirname, 'content');
    const uploadsDir = path.join(__dirname, 'public', 'uploads');

    if (fs.existsSync(contentDir)) archive.directory(contentDir, 'content');
    if (fs.existsSync(uploadsDir)) archive.directory(uploadsDir, 'uploads');

    archive.finalize();
  } catch (e) {
    return res.status(500).send('يرجى تثبيت archiver عبر npm install');
  }
});

// GET Content
app.get('/api/content', (req, res) => {
  const articlesDir = path.join(__dirname, 'content', 'articles');
  const thoughtsDir = path.join(__dirname, 'content', 'thoughts');
  const videosDir = path.join(__dirname, 'content', 'videos');
  const libraryDir = path.join(__dirname, 'content', 'library');
  const likesDir = path.join(__dirname, 'content', 'likes');
  const commentsDir = path.join(__dirname, 'content', 'comments');

  ensureDir(articlesDir);
  ensureDir(thoughtsDir);
  ensureDir(videosDir);
  ensureDir(libraryDir);
  ensureDir(likesDir);
  ensureDir(commentsDir);

  const readJsonFiles = (dir) => {
    try {
      return fs.readdirSync(dir)
        .filter(f => f.endsWith('.json'))
        .map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')));
    } catch { return []; }
  };

  const articles = readJsonFiles(articlesDir).sort((a, b) => new Date(b.date) - new Date(a.date));
  const thoughts = readJsonFiles(thoughtsDir).sort((a, b) => new Date(b.date) - new Date(a.date));
  const videos = readJsonFiles(videosDir).sort((a, b) => new Date(b.date) - new Date(a.date));
  const library = readJsonFiles(libraryDir).sort((a, b) => new Date(b.date) - new Date(a.date));

  let likes = {};
  const likesFile = path.join(likesDir, 'likes.json');
  if (fs.existsSync(likesFile)) {
    try { likes = JSON.parse(fs.readFileSync(likesFile, 'utf-8')); } catch {}
  }

  let comments = {};
  const commentsFile = path.join(commentsDir, 'comments.json');
  if (fs.existsSync(commentsFile)) {
    try { comments = JSON.parse(fs.readFileSync(commentsFile, 'utf-8')); } catch {}
  }

  res.json({ articles, thoughts, videos, library, likes, comments });
});

// Publish
app.post('/api/publish', (req, res) => {
  const { type, data, token } = req.body;
  if (token !== 'session_auth_token_secret') return res.status(403).json({ error: 'غير مصرح' });

  const id = data.id || ('item_' + Date.now());
  data.id = id;
  data.date = data.date || new Date().toISOString().split('T')[0];

  let targetDir;
  if (type === 'article') targetDir = path.join(__dirname, 'content', 'articles');
  else if (type === 'thought') targetDir = path.join(__dirname, 'content', 'thoughts');
  else if (type === 'video') targetDir = path.join(__dirname, 'content', 'videos');
  else if (type === 'library') targetDir = path.join(__dirname, 'content', 'library');
  else return res.status(400).json({ error: 'نوع غير معروف' });

  ensureDir(targetDir);
  fs.writeFileSync(path.join(targetDir, `${id}.json`), JSON.stringify(data, null, 2), 'utf-8');
  res.json({ success: true, item: data });
});

// Track Reads & Downloads
app.post('/api/library/track', (req, res) => {
  const { id, action } = req.body;
  if (!id || !['read', 'download'].includes(action)) {
    return res.status(400).json({ error: 'طلب غير صالح' });
  }

  const libraryDir = path.join(__dirname, 'content', 'library');
  const filePath = path.join(libraryDir, `${id}.json`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'الملف غير موجود' });
  }

  try {
    const item = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (action === 'read') {
      item.readsCount = (item.readsCount || 0) + 1;
    } else if (action === 'download') {
      item.downloadsCount = (item.downloadsCount || 0) + 1;
    }
    fs.writeFileSync(filePath, JSON.stringify(item, null, 2), 'utf-8');
    res.json({ success: true, readsCount: item.readsCount, downloadsCount: item.downloadsCount });
  } catch (e) {
    res.status(500).json({ error: 'خطأ في حفظ العداد' });
  }
});

// Delete
app.post('/api/delete', (req, res) => {
  const { type, id, token } = req.body;
  if (token !== 'session_auth_token_secret') return res.status(403).json({ error: 'غير مصرح' });

  let folder = type === 'library' ? 'library' : `${type}s`;
  const filePath = path.join(__dirname, 'content', folder, `${id}.json`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return res.json({ success: true });
  }
  res.status(404).json({ error: 'العنصر غير موجود' });
});

// Likes & Comments
app.post('/api/like', (req, res) => {
  const { id } = req.body;
  const likesDir = path.join(__dirname, 'content', 'likes');
  ensureDir(likesDir);
  const likesFile = path.join(likesDir, 'likes.json');
  let likes = {};
  if (fs.existsSync(likesFile)) {
    try { likes = JSON.parse(fs.readFileSync(likesFile, 'utf-8')); } catch {}
  }
  likes[id] = (likes[id] || 0) + 1;
  fs.writeFileSync(likesFile, JSON.stringify(likes, null, 2), 'utf-8');
  res.json({ success: true, count: likes[id] });
});

app.post('/api/comment', (req, res) => {
  const { postId, author, content } = req.body;
  if (!postId || !author || !content) return res.status(400).json({ error: 'بيانات ناقصة' });
  const commentsDir = path.join(__dirname, 'content', 'comments');
  ensureDir(commentsDir);
  const commentsFile = path.join(commentsDir, 'comments.json');
  let comments = {};
  if (fs.existsSync(commentsFile)) {
    try { comments = JSON.parse(fs.readFileSync(commentsFile, 'utf-8')); } catch {}
  }
  if (!comments[postId]) comments[postId] = [];
  const newComment = { id: 'c_' + Date.now(), author, content, date: new Date().toLocaleDateString('ar-SA') };
  comments[postId].unshift(newComment);
  fs.writeFileSync(commentsFile, JSON.stringify(comments, null, 2), 'utf-8');
  res.json({ success: true, comment: newComment });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(` منصة التدوين والمكتبة الرقمية تعمل: http://localhost:${PORT}`);
  console.log(` كلمة مرور لوحة التحكم: ${ADMIN_PASSWORD}`);
  console.log(`====================================================`);
});
