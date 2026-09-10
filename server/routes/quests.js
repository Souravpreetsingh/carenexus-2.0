const express = require('express');
const router = express.Router();
const User = require('../models/User');
const auth = require('../middleware/auth');

const ALL_QUESTS = [
  { id: 'quest_checkin', title: 'Daily Sanctuary Check-in', description: 'Log in and register your daily check-in', points: 10, icon: 'edit_calendar' },
  { id: 'quest_reflect', title: 'Reflect Studio Session', description: 'Spend 3 minutes in the Reflect Studio', points: 15, icon: 'self_improvement' },
  { id: 'quest_ai_chat', title: 'CareBot AI Conversation', description: 'Share your thoughts with CareBot AI', points: 10, icon: 'smart_toy' },
  { id: 'quest_journal', title: 'Sanctuary Journal Entry', description: 'Write an entry in your mood journal', points: 15, icon: 'auto_stories' },
  { id: 'quest_book_mentor', title: 'Book a Peer Mentor Session', description: 'Schedule a 1-on-1 session with a mentor', points: 25, icon: 'event_available' }
];

const ALL_BADGES = [
  { badgeId: 'badge_pioneer', title: 'Sanctuary Pioneer 🌿', icon: 'spa', description: 'Completed your first daily check-in' },
  { badgeId: 'badge_streak_3', title: '3-Day Calm Voyager ⛵', icon: 'sailing', description: 'Maintained a 3-day mindfulness streak' },
  { badgeId: 'badge_streak_7', title: 'Weekly Zen Master 🧘', icon: 'self_improvement', description: 'Achieved a 7-day continuous mindfulness streak' },
  { badgeId: 'badge_mentor_peer', title: 'Peer Beacon 🤝', icon: 'handshake', description: 'Booked a peer mentor guidance session' },
  { badgeId: 'badge_quest_champion', title: 'Mindful Soul ✨', icon: 'auto_awesome', description: 'Earned 100+ sanctuary wellness points' }
];

function getTodayString() {
  const d = new Date();
  return d.toISOString().split('T')[0];
}

function getYesterdayString() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

// Get quest and streak status
router.get('/my-status', auth, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    const today = getTodayString();
    
    // Reset completedQuestsToday if last check in was prior date
    if (user.lastCheckInDate && user.lastCheckInDate !== today && user.lastCheckInDate !== getYesterdayString()) {
      // Streak broken if missed more than 1 day
      user.streakCount = 0;
      user.completedQuestsToday = [];
      await user.save();
    } else if (user.lastCheckInDate && user.lastCheckInDate !== today) {
      user.completedQuestsToday = [];
      await user.save();
    }

    const questsWithStatus = ALL_QUESTS.map(q => ({
      ...q,
      completed: (user.completedQuestsToday || []).includes(q.id)
    }));

    res.json({
      streakCount: user.streakCount || 0,
      lastCheckInDate: user.lastCheckInDate || '',
      checkedInToday: user.lastCheckInDate === today,
      points: user.points || 0,
      unlockedBadges: user.unlockedBadges || [],
      allBadges: ALL_BADGES,
      quests: questsWithStatus
    });
  } catch (err) {
    console.error('Error getting quest status:', err);
    res.status(500).json({ message: 'Server error loading quest status.' });
  }
});

// Perform Daily Check-in
router.post('/check-in', auth, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    const today = getTodayString();
    const yesterday = getYesterdayString();

    if (user.lastCheckInDate === today) {
      return res.json({ message: 'You have already checked in today!', streakCount: user.streakCount, points: user.points, unlockedBadges: user.unlockedBadges });
    }

    if (user.lastCheckInDate === yesterday) {
      user.streakCount = (user.streakCount || 0) + 1;
    } else {
      user.streakCount = 1;
    }

    user.lastCheckInDate = today;
    user.points = (user.points || 0) + 10;

    if (!user.completedQuestsToday.includes('quest_checkin')) {
      user.completedQuestsToday.push('quest_checkin');
    }

    // Evaluate badges
    const unlockedIds = (user.unlockedBadges || []).map(b => b.badgeId);

    // Pioneer Badge
    if (!unlockedIds.includes('badge_pioneer')) {
      user.unlockedBadges.push(ALL_BADGES.find(b => b.badgeId === 'badge_pioneer'));
    }
    // 3-Day Streak Badge
    if (user.streakCount >= 3 && !unlockedIds.includes('badge_streak_3')) {
      user.unlockedBadges.push(ALL_BADGES.find(b => b.badgeId === 'badge_streak_3'));
    }
    // 7-Day Streak Badge
    if (user.streakCount >= 7 && !unlockedIds.includes('badge_streak_7')) {
      user.unlockedBadges.push(ALL_BADGES.find(b => b.badgeId === 'badge_streak_7'));
    }
    // Points Badge
    if (user.points >= 100 && !unlockedIds.includes('badge_quest_champion')) {
      user.unlockedBadges.push(ALL_BADGES.find(b => b.badgeId === 'badge_quest_champion'));
    }

    await user.save();

    res.json({
      message: `Daily Check-in Complete! 🔥 ${user.streakCount}-Day Streak Active`,
      streakCount: user.streakCount,
      points: user.points,
      unlockedBadges: user.unlockedBadges
    });
  } catch (err) {
    console.error('Error during check-in:', err);
    res.status(500).json({ message: 'Server error processing check-in.' });
  }
});

// Complete specific daily quest
router.post('/complete', auth, async (req, res) => {
  try {
    const { questId } = req.body;
    const quest = ALL_QUESTS.find(q => q.id === questId);
    if (!quest) return res.status(400).json({ message: 'Invalid quest ID.' });

    const userId = req.user.id || req.user._id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    if (!user.completedQuestsToday.includes(questId)) {
      user.completedQuestsToday.push(questId);
      user.points = (user.points || 0) + quest.points;

      // Mentor badge check
      const unlockedIds = (user.unlockedBadges || []).map(b => b.badgeId);
      if (questId === 'quest_book_mentor' && !unlockedIds.includes('badge_mentor_peer')) {
        user.unlockedBadges.push(ALL_BADGES.find(b => b.badgeId === 'badge_mentor_peer'));
      }
      if (user.points >= 100 && !unlockedIds.includes('badge_quest_champion')) {
        user.unlockedBadges.push(ALL_BADGES.find(b => b.badgeId === 'badge_quest_champion'));
      }

      await user.save();
    }

    res.json({
      message: `Quest "${quest.title}" completed! +${quest.points} Points`,
      points: user.points,
      unlockedBadges: user.unlockedBadges
    });
  } catch (err) {
    console.error('Error completing quest:', err);
    res.status(500).json({ message: 'Server error completing quest.' });
  }
});

module.exports = router;
