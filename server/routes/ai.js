const express = require('express');
const router = express.Router();
const { analyzeText, generateMoodInsight } = require('../utils/nlpEngine');

// Empathetic response bank by mood category
const EMPATHY_RESPONSES = {
  anxiety: [
    "I hear you, and it's completely okay to feel anxious right now. Let's take a slow, deep breath together. Inhale peace, exhale tension. Would you like to try our 4-7-8 guided breathing or listen to soothing rain soundscapes?",
    "Anxiety can feel heavy, but remember that you are safe in this sanctuary. You don't have to carry this alone. Would you like me to connect you with an active peer mentor?"
  ],
  lonely: [
    "Feeling lonely can be overwhelming, but I'm right here with you. You are part of the CareNexus sanctuary community, where thousands of supportive peers share this journey with you.",
    "Your feelings are valid. If you'd like, I can help match you with a verified peer guide who specializes in compassionate, non-judgmental listening."
  ],
  overwhelmed: [
    "When everything feels like too much at once, step back and focus on just this moment. Let's break things down into small, gentle steps. How can I best support you right now?",
    "You've been holding up a lot. Take a moment to rest. Our Zen Soundscapes or guided 3D reflect studio might give your mind a quiet break."
  ],
  positive: [
    "I'm so glad to hear you're feeling good today! Celebrating small moments of joy and peace is wonderful. How can we keep this positive energy going?",
    "That is beautiful to hear! Remember to bookmark this peaceful feeling for days when you might need a reminder of your inner strength."
  ],
  default: [
    "Thank you for sharing your thoughts with me. I'm CareBot, your 24/7 anonymous AI companion. I'm always here to listen, offer calming exercises, or introduce you to a compassionate peer mentor.",
    "I'm listening. Take all the time you need to express what's on your mind. You are in a safe, encrypted sanctuary."
  ]
};

function getRandomResponse(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// POST /api/ai/chat
router.post('/chat', (req, res) => {
  try {
    const { message, mood } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message text is required' });
    }

    const nlpResult = analyzeText(message);
    const lower = message.toLowerCase();

    // 1. Critical Crisis Detection Safety Escalation
    if (nlpResult.crisisLevel === 'critical') {
      return res.json({
        reply: "⚠️ I care deeply about your safety. You matter, and support is available 24/7. Please connect immediately with dedicated crisis counselors or press below to match with a priority peer guide.",
        isCrisis: true,
        crisisInfo: {
          lifeline: "Call or Text 988 (Suicide & Crisis Lifeline)",
          textLine: "Text HOME to 741741 (Crisis Text Line)"
        },
        action: "OPEN_MENTORS"
      });
    }

    // 2. Specific intent routing
    let reply = '';
    let suggestedAction = null;

    if (lower.includes('breath') || lower.includes('inhale') || lower.includes('exhale')) {
      reply = "Let's practice 4-7-8 Stress Release Breathing. Breathe in gently for 4 seconds, hold for 7 seconds, and exhale fully for 8 seconds. Click below to launch the Guided 3D Reflect Studio trainer!";
      suggestedAction = "OPEN_REFLECT";
    } else if (lower.includes('sound') || lower.includes('music') || lower.includes('rain') || lower.includes('waves')) {
      reply = "Soothing ambient soundscapes can quiet an overactive mind. Experience our live Web Audio synthesizers (Rain, Waves, Forest, or 432Hz Alpha Waves).";
      suggestedAction = "OPEN_SOUNDSCAPES";
    } else if (lower.includes('mentor') || lower.includes('peer') || lower.includes('human') || lower.includes('talk to someone')) {
      reply = "Our community has vetted, crisis-trained peer mentors ready for anonymous real-time chat. Let me open the Peer Mentors Directory for you.";
      suggestedAction = "OPEN_MENTORS";
    } else if (nlpResult.sentiment === 'high_distress' || lower.includes('anx') || lower.includes('stress')) {
      reply = getRandomResponse(EMPATHY_RESPONSES.anxiety);
    } else if (lower.includes('lonely') || lower.includes('alone')) {
      reply = getRandomResponse(EMPATHY_RESPONSES.lonely);
    } else if (lower.includes('overwhelm') || lower.includes('tired') || lower.includes('exhaust')) {
      reply = getRandomResponse(EMPATHY_RESPONSES.overwhelmed);
    } else if (nlpResult.sentiment === 'positive') {
      reply = getRandomResponse(EMPATHY_RESPONSES.positive);
    } else {
      reply = getRandomResponse(EMPATHY_RESPONSES.default);
    }

    res.json({
      reply,
      sentiment: nlpResult.sentiment,
      crisisLevel: nlpResult.crisisLevel,
      suggestedAction
    });

  } catch (err) {
    console.error('AI Chat Error:', err);
    res.status(500).json({ error: 'AI processing error' });
  }
});

module.exports = router;
