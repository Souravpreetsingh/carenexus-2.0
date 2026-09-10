const router = require('express').Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const auth = require('../middleware/auth');

// Register
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, role } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ message: 'All fields are required' });
    }
    const exists = await User.findOne({ $or: [{ email }, { username }] });
    if (exists) return res.status(409).json({ message: 'Username or email already taken' });

    const safeRole = ['user', 'mentor'].includes(role) ? role : 'user';
    const profileData = safeRole === 'mentor' ? {
      bio: 'Peer mentor ready to support you in a safe space.',
      education: [],
      achievements: [],
      specialties: ['Peer Guidance', 'Active Listening'],
      rating: 5.0,
      isAvailable: true
    } : {};

    const user = await User.create({ username, email, password, role: safeRole, ...profileData });
    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user: { id: user._id, username: user.username, role: user.role } });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });

    const match = await user.comparePassword(password);
    if (!match) return res.status(401).json({ message: 'Invalid credentials' });

    if (!user.isApproved) {
      return res.status(403).json({ message: 'Your mentor account is pending approval by an admin.' });
    }

    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user._id, username: user.username, role: user.role } });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

function formatMentor(raw) {
  const m = raw.toObject ? raw.toObject() : { ...raw };
  if (!m.bio) {
    m.bio = 'Peer mentor ready to support you.';
  }
  if (!m.education) m.education = [];
  if (!m.achievements) m.achievements = [];
  if (!m.specialties || m.specialties.length === 0) {
    m.specialties = ['Peer Guidance', 'Active Listening'];
  }
  return m;
}

// Get list of active mentors
router.get('/mentors', async (req, res) => {
  try {
    const rawMentors = await User.find({ role: 'mentor', isApproved: true }, '-password').sort('-createdAt');
    const mentors = rawMentors.map(formatMentor);
    res.json({ mentors });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Get single mentor profile by ID
router.get('/mentors/:id', async (req, res) => {
  try {
    const rawMentor = await User.findOne({ _id: req.params.id, role: 'mentor' }, '-password');
    if (!rawMentor) return res.status(404).json({ message: 'Mentor profile not found' });
    res.json({ mentor: formatMentor(rawMentor) });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Get current user profile
router.get('/me', auth, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const user = await User.findById(userId, '-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ user: formatMentor(user) });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Update profile (bio, specialties, isAvailable)
router.patch('/profile', auth, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { bio, specialties, isAvailable } = req.body;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (typeof bio === 'string') user.bio = bio;
    if (Array.isArray(specialties)) user.specialties = specialties;
    if (typeof isAvailable === 'boolean') user.isAvailable = isAvailable;

    await user.save();
    res.json({ message: 'Profile updated successfully!', user: formatMentor(user) });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
