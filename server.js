const express = require('express');
const { Telegraf } = require('telegraf');
const admin = require('firebase-admin');
const cors = require('cors');

// Firebase sozlamalari
const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL
};
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

const app = express();
app.use(express.json());
app.use(cors());

// Telegram bot
const bot = new Telegraf(process.env.BOT_TOKEN);

bot.command('start', (ctx) => {
  ctx.reply('Challenge botga xush kelibsiz! Tez orada veb-ilova ochiladi.');
});

bot.launch();

// API endpoint’lar
app.get('/api/challenges/active', async (req, res) => {
  const userId = req.query.userId;
  const snapshot = await db.collection('challenges').where('isActive', '==', true).get();
  const challenges = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  const userDoc = await db.collection('users').doc(userId).get();
  const user = userDoc.data() || { premium: false };
  const filtered = challenges.filter(ch => ch.type !== 'main' || user.premium);
  res.json(filtered);
});

app.get('/api/challenges/all', async (req, res) => {
  const snapshot = await db.collection('challenges').get();
  const challenges = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  res.json(challenges);
});

app.post('/api/challenges/join', async (req, res) => {
  const { challengeId, userId } = req.body;
  const challengeDoc = await db.collection('challenges').doc(challengeId).get();
  const challenge = challengeDoc.data();
  if (new Date() > new Date(challenge.joinDeadline)) {
    return res.status(400).json({ error: 'Qo‘shilish muddati tugagan' });
  }
  const userDoc = await db.collection('users').doc(userId).get();
  const user = userDoc.data() || { premium: false, challengesJoined: 0 };
  if (challenge.type === 'main' && !user.premium) {
    return res.status(403).json({ error: 'Premium kerak' });
  }
  if (!user.premium && user.challengesJoined >= 2) {
    return res.status(403).json({ error: 'Faqat premium foydalanuvchilar 2 tadan ko‘p challenge’ga qo‘shila oladi' });
  }
  await db.collection('challenges').doc(challengeId).update({
    participants: admin.firestore.FieldValue.arrayUnion({ userId, score: 0, joinedDay: new Date() })
  });
  await db.collection('users').doc(userId).set({
    challengesJoined: admin.firestore.FieldValue.increment(1)
  }, { merge: true });
  await db.collection('userChallenges').doc(`${userId}_${challengeId}`).set({
    challengeId, userId, dailyProgress: [], joined: true
  });
  res.json({ success: true });
});

app.post('/api/challenges/create', async (req, res) => {
  const { title, userId, friends = [] } = req.body;
  const userDoc = await db.collection('users').doc(userId).get();
  const user = userDoc.data() || { premium: false, challengesCreated: 0 };
  const limit = user.premium ? 5 : 3;
  if (user.challengesCreated >= limit) {
    return res.status(400).json({ error: 'Challenge yaratish limiti tugagan' });
  }
  const challengeId = db.collection('challenges').doc().id;
  const now = new Date();
  await db.collection('challenges').doc(challengeId).set({
    title,
    days: 30,
    type: 'user',
    currentDay: 1,
    participants: [{ userId, score: 0 }].concat(friends.map(f => ({ userId: f, score: 0 }))),
    createdBy: userId,
    joinDeadline: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
    endDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    isActive: true
  });
  await db.collection('users').doc(userId).update({
    challengesCreated: admin.firestore.FieldValue.increment(1)
  });
  res.json({ challengeId });
});

app.get('/api/user/profile/:userId', async (req, res) => {
  const userId = req.params.userId;
  const userDoc = await db.collection('users').doc(userId).get();
  const user = userDoc.data() || { friends: [], subscriptions: [], totalScore: 0, premium: false };
  user.friendCount = user.friends?.length || 0;
  user.subCount = user.subscriptions?.length || 0;
  const rankingSnapshot = await db.collection('globalRanking').doc(userId).get();
  user.globalRank = rankingSnapshot.data()?.score || 0;
  res.json(user);
});

app.post('/api/admin/main-challenge', async (req, res) => {
  const { userId, title } = req.body;
  if (userId !== process.env.ADMIN_USER_ID) {
    return res.status(403).json({ error: 'Faqat admin challenge qo‘shishi mumkin' });
  }
  const challengeId = db.collection('challenges').doc().id;
  const now = new Date();
  await db.collection('challenges').doc(challengeId).set({
    title,
    days: 30,
    type: 'main',
    currentDay: 1,
    participants: [],
    createdBy: userId,
    joinDeadline: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
    endDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    isActive: true
  });
  res.json({ challengeId });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
