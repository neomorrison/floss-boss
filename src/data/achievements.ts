// Achievements. DESIGN 8.10. The sim checks them (sim/goals.ts); the UI lists them.
export interface AchievementDef { id: string; name: string; text: string }

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'firstChunk', name: 'First Crunch', text: 'Pop your first tartar chunk.' },
  { id: 'graduate', name: 'Graduate', text: 'Finish hygiene school.' },
  { id: 'fiveStar', name: 'Five Stars', text: 'Earn a five-star cleaning.' },
  { id: 'perfect', name: 'Sparkling Smile', text: 'Finish a perfect clean.' },
  { id: 'combo10', name: 'Crunch Combo', text: 'Pop 10 chunks in one combo.' },
  { id: 'chunks100', name: 'Tartar Hunter', text: 'Pop 100 tartar chunks.' },
  { id: 'chunks1000', name: 'Tartar Terminator', text: 'Pop 1,000 tartar chunks.' },
  { id: 'speed60', name: 'Speed Scaler', text: 'Finish a cleaning with 4+ stars in under 60 seconds.' },
  { id: 'noOw', name: 'Gentle Giant', text: 'Clean a nervous patient without a single gum slip.' },
  { id: 'senior', name: 'Senior Hygienist', text: 'Reach level 4.' },
  { id: 'lead', name: 'Lead Hygienist', text: 'Reach level 7.' },
  { id: 'ultrasonic', name: 'Good Vibrations', text: 'Buy an ultrasonic scaler.' },
  { id: 'owner', name: 'Open for Business', text: 'Open your own practice.' },
  { id: 'firstHire', name: 'Team Player', text: 'Hire your first team member.' },
  { id: 'fullStaff', name: 'Full House', text: 'Staff every operatory in an office.' },
  { id: 'dentist', name: 'Doctor in the House', text: 'Hire a dentist.' },
  { id: 'rating45', name: 'Five-Star Office', text: 'Reach a 4.5 rating.' },
  { id: 't2', name: 'Main Street', text: 'Move into a Main Street Office.' },
  { id: 't3', name: 'Plaza Life', text: 'Move into a Medical Plaza.' },
  { id: 't4', name: 'Top of the Tower', text: 'Move into Smile Tower.' },
  { id: 'chain2', name: 'Franchise', text: 'Own two locations.' },
  { id: 'chain5', name: 'Floss Boss', text: 'Own five locations.' },
  { id: 'million', name: 'Millionaire Molars', text: 'Reach a $1M valuation.' },
  { id: 'debtFree', name: 'Debt Free', text: 'Pay off a bank loan.' },
];
