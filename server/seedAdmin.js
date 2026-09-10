require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const User = require('./models/User');

async function seed() {
  const customUri = process.env.MONGO_URI;
  if (customUri && !customUri.includes('127.0.0.1') && !customUri.includes('localhost')) {
    await mongoose.connect(customUri);
  } else {
    try {
      await mongoose.connect(customUri || 'mongodb://127.0.0.1:27017/emotional_support', { serverSelectionTimeoutMS: 2000 });
    } catch {
      const mongoServer = await MongoMemoryServer.create({ binary: { version: '4.4.18' } });
      await mongoose.connect(mongoServer.getUri());
    }
  }

  const exists = await User.findOne({ role: 'admin' });
  if (exists) { console.log('Admin already exists:', exists.email); process.exit(0); }

  await User.create({
    username: 'admin',
    email: 'admin@safespace.com',
    password: 'Admin@1234',
    role: 'admin'
  });
  console.log('Admin created — email: admin@safespace.com  password: Admin@1234');
  process.exit(0);
}

seed().catch(err => { console.error(err.message); process.exit(1); });

