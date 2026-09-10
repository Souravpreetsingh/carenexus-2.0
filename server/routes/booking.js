const express = require('express');
const router = express.Router();
const Booking = require('../models/Booking');
const User = require('../models/User');
const auth = require('../middleware/auth');

// Create a new mentor session booking
router.post('/', auth, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { mentorId, date, timeSlot, topic, notes } = req.body;
    if (!mentorId || !date || !timeSlot) {
      return res.status(400).json({ message: 'Mentor ID, date, and time slot are required.' });
    }

    const mentor = await User.findById(mentorId);
    if (!mentor) {
      return res.status(404).json({ message: 'Mentor not found.' });
    }

    // Check if slot is already booked for this mentor
    const existing = await Booking.findOne({
      mentor: mentorId,
      date,
      timeSlot,
      status: { $in: ['confirmed', 'pending'] }
    });

    if (existing) {
      return res.status(409).json({ message: 'This time slot is already booked. Please select another slot.' });
    }

    const booking = await Booking.create({
      user: userId,
      mentor: mentorId,
      date,
      timeSlot,
      topic: topic || 'General Support & Mentorship',
      notes: notes || '',
      status: 'confirmed'
    });

    // Populate user and mentor info
    const populated = await Booking.findById(booking._id)
      .populate('mentor', 'username email bio specialties rating')
      .populate('user', 'username email');

    // Auto-mark quest completion for user
    try {
      const user = await User.findById(userId);
      if (user) {
        if (!user.completedQuestsToday.includes('quest_book_mentor')) {
          user.completedQuestsToday.push('quest_book_mentor');
          user.points = (user.points || 0) + 25;
          await user.save();
        }
      }
    } catch (e) {
      console.error('Failed to update quest for booking:', e);
    }

    res.status(201).json({ message: 'Session booked successfully!', booking: populated });
  } catch (err) {
    console.error('Error creating booking:', err);
    res.status(500).json({ message: 'Server error booking session.' });
  }
});

// Fetch my bookings (as user or mentor)
router.get('/my-bookings', auth, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const bookings = await Booking.find({
      $or: [{ user: userId }, { mentor: userId }]
    })
      .populate('mentor', 'username email bio specialties rating')
      .populate('user', 'username email')
      .sort({ createdAt: -1 });

    res.json(bookings);
  } catch (err) {
    console.error('Error fetching bookings:', err);
    res.status(500).json({ message: 'Server error fetching bookings.' });
  }
});

// Fetch unavailable time slots for a mentor on a specific date
router.get('/mentor-slots/:mentorId', auth, async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) {
      return res.status(400).json({ message: 'Date parameter is required.' });
    }

    const bookings = await Booking.find({
      mentor: req.params.mentorId,
      date,
      status: { $in: ['confirmed', 'pending'] }
    }).select('timeSlot');

    const bookedSlots = bookings.map(b => b.timeSlot);
    res.json({ bookedSlots });
  } catch (err) {
    console.error('Error fetching mentor slots:', err);
    res.status(500).json({ message: 'Server error fetching mentor slots.' });
  }
});

// Update booking status
router.patch('/:id/status', auth, async (req, res) => {
  try {
    const userId = (req.user.id || req.user._id).toString();
    const { status } = req.body;
    if (!['pending', 'confirmed', 'completed', 'cancelled'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status.' });
    }

    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({ message: 'Booking not found.' });
    }

    // Verify permission
    if (booking.user.toString() !== userId && booking.mentor.toString() !== userId) {
      return res.status(403).json({ message: 'Unauthorized.' });
    }

    booking.status = status;
    await booking.save();

    res.json({ message: `Booking status updated to ${status}.`, booking });
  } catch (err) {
    console.error('Error updating booking status:', err);
    res.status(500).json({ message: 'Server error updating booking status.' });
  }
});

module.exports = router;
