// Staff roles, traits and names. DESIGN 8.5.
import type { StaffRole, TraitId } from '../core/types';

export interface RoleDef {
  id: StaffRole;
  name: string;
  plural: string;
  blurb: string;
  askBase: number;       // salary ask = askBase + askPerStat * statAvg
  askPerStat: number;
  scrubs: string;        // tint for the 3D character (hex)
  model: string;
}

export const ROLES: Record<StaffRole, RoleDef> = {
  hygienist: { id: 'hygienist', name: 'Hygienist', plural: 'Hygienists', blurb: 'Cleans patients in an operatory.', askBase: 200, askPerStat: 4, scrubs: '#2BB3A3', model: 'char_staff' },
  receptionist: { id: 'receptionist', name: 'Receptionist', plural: 'Receptionists', blurb: 'Checks patients in faster, books more, fewer no-shows.', askBase: 120, askPerStat: 1.5, scrubs: '#4C7BD9', model: 'char_staff' },
  assistant: { id: 'assistant', name: 'Dental Assistant', plural: 'Assistants', blurb: 'Pairs with an operatory. Cleanings 20% faster.', askBase: 110, askPerStat: 1.4, scrubs: '#9B6CD6', model: 'char_staff' },
  dentist: { id: 'dentist', name: 'Dentist', plural: 'Dentists', blurb: 'Unlocks exams and fillings. Big revenue.', askBase: 800, askPerStat: 6, scrubs: '#F4F6F8', model: 'char_dentist' },
  manager: { id: 'manager', name: 'Office Manager', plural: 'Managers', blurb: 'Morale up, costs down, runs the office while you are away.', askBase: 350, askPerStat: 3, scrubs: '#E9A23B', model: 'char_staff' },
};

export const ROLE_IDS: StaffRole[] = ['hygienist', 'receptionist', 'assistant', 'dentist', 'manager'];

export interface TraitDef { id: TraitId; name: string; text: string; good: boolean }
export const TRAITS: Record<TraitId, TraitDef> = {
  perfectionist: { id: 'perfectionist', name: 'Perfectionist', text: '+5% quality, 10% slower', good: true },
  speedy: { id: 'speedy', name: 'Speedy', text: '15% faster, -3% quality', good: true },
  charmer: { id: 'charmer', name: 'Charmer', text: 'Patients feel 10% more comfortable', good: true },
  clumsy: { id: 'clumsy', name: 'Clumsy', text: 'Sometimes botches a cleaning', good: false },
  nightOwl: { id: 'nightOwl', name: 'Night Owl', text: 'Slow first hour, happier overall', good: true },
  loyal: { id: 'loyal', name: 'Loyal', text: 'Never quits', good: true },
  ambitious: { id: 'ambitious', name: 'Ambitious', text: 'Levels up twice as fast, asks for raises', good: true },
};

export const STAFF_FIRST = ['Ava', 'Ben', 'Carla', 'Dev', 'Elena', 'Femi', 'Grace', 'Hank', 'Iris', 'Jin', 'Kara', 'Luis', 'Maya', 'Nico', 'Olive', 'Pablo', 'Quinn', 'Rosa', 'Sanjay', 'Tess', 'Uma', 'Vince', 'Wren', 'Yusuf', 'Zoe'];
export const STAFF_LAST = ['Park', 'Okafor', 'Silva', 'Novak', 'Reyes', 'Kim', 'Haddad', 'Brooks', 'Tanaka', 'Walsh', 'Moreau', 'Singh', 'Lindqvist', 'Adeyemi', 'Costa', 'Nguyen'];

/** Number of staff portrait images available (public/img/staff/staff_<n>.webp). */
export const STAFF_PORTRAITS = 18;
