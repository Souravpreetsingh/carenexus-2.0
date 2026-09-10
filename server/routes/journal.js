const router = require('express').Router();
const Journal = require('../models/Journal');
const auth = require('../middleware/auth');
const { generateMoodInsight } = require('../utils/nlpEngine');

// GET /api/journal/my - Get user's mood journal history and analytics
router.get('/my', auth, async (req, res) => {
  try {
    const entries = await Journal.find({ user: req.user.id })
      .sort('-createdAt')
      .limit(30);

    const total = entries.length;
    const moodCounts = {};
    let intensitySum = 0;

    entries.forEach(e => {
      moodCounts[e.mood] = (moodCounts[e.mood] || 0) + 1;
      intensitySum += e.intensity || 5;
    });

    const averageIntensity = total > 0 ? (intensitySum / total).toFixed(1) : 0;

    // Calculate daily streak
    let streakCount = 0;
    if (total > 0) {
      const dates = entries.map(e => new Date(e.createdAt).toISOString().split('T')[0]);
      const uniqueDates = [...new Set(dates)].sort().reverse();
      
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

      if (uniqueDates.includes(today) || uniqueDates.includes(yesterday)) {
        streakCount = 1;
        let curr = new Date(uniqueDates[0]);
        for (let i = 1; i < uniqueDates.length; i++) {
          const next = new Date(uniqueDates[i]);
          const diffDays = Math.round((curr - next) / (1000 * 60 * 60 * 24));
          if (diffDays === 1) {
            streakCount++;
            curr = next;
          } else {
            break;
          }
        }
      }
    }

    // Badges calculation
    const badges = [];
    if (total >= 1) badges.push({ id: 'novice', title: 'Mindfulness Novice', icon: 'spa', desc: 'Logged first daily check-in' });
    if (streakCount >= 3) badges.push({ id: 'streak3', title: '3-Day Calm Streak', icon: 'local_fire_department', desc: 'Logged 3 consecutive days' });
    if (streakCount >= 7) badges.push({ id: 'streak7', title: '7-Day Resilience', icon: 'verified', desc: 'Maintained 7-day wellness streak' });
    if (total >= 10) badges.push({ id: 'pioneer', title: 'Self-Care Pioneer', icon: 'military_tech', desc: 'Completed 10 mood reflections' });

    // Stability score (0-100)
    let stabilityScore = 85;
    if (total > 0) {
      const calmCount = (moodCounts['Calm'] || 0) + (moodCounts['Hopeful'] || 0);
      stabilityScore = Math.min(98, Math.max(60, Math.round((calmCount / total) * 40 + 60)));
    }

    // Chart points (chronological order)
    const chartPoints = [...entries].reverse().map(e => ({
      id: e._id,
      date: new Date(e.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' }),
      mood: e.mood,
      intensity: e.intensity || 5,
      note: e.note || ''
    }));

    res.json({
      entries,
      analytics: {
        totalEntries: total,
        averageIntensity,
        moodCounts,
        streakCount,
        stabilityScore,
        badges,
        chartPoints
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/journal/entry - Create a new mood entry with AI insights
router.post('/entry', auth, async (req, res) => {
  try {
    const { mood, intensity, note } = req.body;
    if (!mood) return res.status(400).json({ message: 'Mood parameter is required.' });

    const { insight, mindfulnessExercise } = generateMoodInsight(mood, intensity, note);

    const entry = await Journal.create({
      user: req.user.id,
      mood,
      intensity: Number(intensity) || 5,
      note: note || '',
      aiInsight: insight,
      mindfulnessExercise
    });

    res.status(201).json({ entry });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
