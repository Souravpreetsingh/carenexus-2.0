/**
 * CareNexus AI & NLP Safety Engine
 * Lightweight, high-performance in-memory NLP module for sentiment analysis
 * and real-time distress/crisis detection.
 */

const CRISIS_TERMS = [
  'suicide', 'kill myself', 'end my life', 'want to die', 'don\'t want to live',
  'hurt myself', 'self harm', 'cutting myself', 'can\'t take it anymore',
  'end it all', 'give up on life', 'hopeless', 'no reason to live',
  'goodbye world', 'overdose', 'hang myself'
];

const MODERATE_DISTRESS_TERMS = [
  'overwhelmed', 'panic attack', 'depressed', 'anxious', 'breakdown',
  'crying', 'lonely', 'terrified', 'exhausted', 'can\'t sleep',
  'nobody cares', 'worthless', 'scared', 'numb'
];

const POSITIVE_LEXICON = {
  'good': 1, 'great': 2, 'better': 1, 'hopeful': 2, 'thankful': 2,
  'calm': 2, 'peaceful': 2, 'happy': 2, 'supported': 2, 'relieved': 2,
  'safe': 2, 'grateful': 2, 'loved': 2, 'relaxed': 1, 'inspired': 2
};

const NEGATIVE_LEXICON = {
  'sad': -1, 'anxious': -2, 'bad': -1, 'worried': -1, 'hurt': -2,
  'lonely': -2, 'scared': -2, 'stressed': -2, 'tired': -1, 'pain': -2,
  'hopeless': -3, 'overwhelmed': -2, 'afraid': -2, 'angry': -1
};

function analyzeText(text) {
  if (!text || typeof text !== 'string') {
    return { score: 0, sentiment: 'neutral', crisisLevel: 'none', triggers: [] };
  }

  const lower = text.toLowerCase();
  const words = lower.match(/\b\w+\b/g) || [];
  
  // 1. Crisis keyword detection
  const crisisTriggers = CRISIS_TERMS.filter(term => lower.includes(term));
  if (crisisTriggers.length > 0) {
    return {
      score: -5,
      sentiment: 'critical_distress',
      crisisLevel: 'critical',
      triggers: crisisTriggers,
      recommendation: 'Immediate crisis lifeline escalation required.'
    };
  }

  // 2. Moderate distress detection
  const distressTriggers = MODERATE_DISTRESS_TERMS.filter(term => lower.includes(term));
  
  // 3. Lexicon sentiment scoring
  let score = 0;
  words.forEach(w => {
    if (POSITIVE_LEXICON[w]) score += POSITIVE_LEXICON[w];
    if (NEGATIVE_LEXICON[w]) score += NEGATIVE_LEXICON[w];
  });

  let crisisLevel = 'none';
  let sentiment = 'neutral';

  if (distressTriggers.length >= 2 || score <= -3) {
    crisisLevel = 'moderate';
    sentiment = 'high_distress';
  } else if (score > 1) {
    sentiment = 'positive';
  } else if (score < 0) {
    sentiment = 'negative';
  }

  return {
    score,
    sentiment,
    crisisLevel,
    triggers: distressTriggers,
    recommendation: crisisLevel === 'moderate' 
      ? 'Peer mentor priority assignment recommended.' 
      : 'Standard supportive engagement.'
  };
}

/**
 * Generates dynamic AI Mood Insights & Mindfulness Prompts based on user journal entry
 */
function generateMoodInsight(mood, intensity, note = '') {
  const normMood = (mood || 'calm').toLowerCase();
  const nInt = Number(intensity) || 5;
  const noteLower = (note || '').toLowerCase();

  let insight = '';
  let mindfulnessExercise = null;

  if (normMood.includes('anx') || normMood.includes('stress') || noteLower.includes('anx')) {
    insight = `We notice elevated stress levels (${nInt}/10). Remember that anxiety is your body's attempt to protect you, but you are safe right now.`;
    mindfulnessExercise = {
      title: '4-7-8 Breathing Technique',
      type: 'Breathing',
      duration: '3 mins',
      steps: [
        'Inhale quietly through your nose for 4 seconds.',
        'Hold your breath gently for 7 seconds.',
        'Exhale slowly through your mouth making a whoosh sound for 8 seconds.',
        'Repeat for 4 cycles.'
      ]
    };
  } else if (normMood.includes('sad') || normMood.includes('depress') || normMood.includes('low')) {
    insight = `You are carrying heavy emotions right now. Acknowledging your feelings without judgment is a sign of deep courage.`;
    mindfulnessExercise = {
      title: '5-4-3-2-1 Grounding Practice',
      type: 'Grounding',
      duration: '4 mins',
      steps: [
        'Look around and name 5 things you can see.',
        'Notice 4 things you can physically touch around you.',
        'Listen for 3 distinct sounds in your environment.',
        'Identify 2 things you can smell or enjoy.',
        'Name 1 positive truth about yourself.'
      ]
    };
  } else if (normMood.includes('exhaust') || normMood.includes('burnout')) {
    insight = `Your energy reserves are low (${nInt}/10). Rest is not something you have to earn—it is a vital human necessity.`;
    mindfulnessExercise = {
      title: 'Body Scan & Muscle Release',
      type: 'Relaxation',
      duration: '5 mins',
      steps: [
        'Sit comfortably and let your shoulders drop down away from your ears.',
        'Unclench your jaw and soften your forehead.',
        'Take three deep, natural breaths into your stomach.',
        'Release all expectations for the next 10 minutes.'
      ]
    };
  } else {
    insight = `You are feeling relatively balanced today. Maintaining moments of gratitude reinforces emotional resilience.`;
    mindfulnessExercise = {
      title: 'Gratitude Reflection',
      type: 'Reflection',
      duration: '2 mins',
      steps: [
        'Think of one small comfort you experienced today.',
        'Notice how your body feels when reflecting on this moment.',
        'Carry this gentle warmth with you into your evening.'
      ]
    };
  }

  return { insight, mindfulnessExercise };
}

module.exports = {
  analyzeText,
  generateMoodInsight
};
