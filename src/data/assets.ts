// Asset keys and URLs. This file is the checklist for the art and audio builders:
// every key listed here should exist as a file, and every consumer must survive a missing file.
import type { ArchetypeId } from '../core/types';

const BASE = (typeof import.meta !== 'undefined' && (import.meta as any).env?.BASE_URL) || './';

export const modelUrl = (key: string) => `${BASE}models/${key}.glb`;
export const imgUrl = (path: string) => `${BASE}img/${path}`;
export const audioUrl = (key: string) => `${BASE}audio/${key}.mp3`;

// ------------------------------------------------------------------ 3D: mouth (art-mouth builder)
// Mouth units (1 unit ~ 8 mm), three.js axes after glTF export: +Y up, +Z toward the camera.
export const MOUTH_MODELS = [
  'tooth_incisor', 'tooth_canine', 'tooth_premolar', 'tooth_molar',
  'gum_upper', 'gum_lower', 'tongue', 'mouth_frame',
  'tartar_a', 'tartar_b', 'tartar_c',
  'debris_popcorn', 'debris_spinach', 'debris_seed', 'debris_candy',
] as const;

// Tools shown in the clean scene and as shop thumbnails (art-mouth builder).
export const TOOL_MODELS = [
  'tool_scaler', 'tool_curette', 'tool_titanium', 'tool_ultrasonic', 'tool_piezo',
  'tool_polisher', 'tool_cordless', 'tool_airpolisher',
  'tool_floss', 'tool_flosspick', 'tool_waterflosser',
  'tool_suction', 'tool_hve', 'tool_syringe',
  'extra_headlamp', 'extra_disclosing', 'extra_headphones', 'extra_loupes',
] as const;

// ------------------------------------------------------------------ 3D: clinic (art-clinic builder)
// Meters, +Y up, model front faces +Z, origin on the floor at the footprint center.
export const CLINIC_MODELS = [
  'chair_basic', 'chair_comfort', 'chair_deluxe',
  'op_lamp', 'op_cart', 'op_counter', 'op_monitor', 'op_tv', 'whitening_lamp', 'intraoral_cam',
  'reception_desk', 'waiting_chair', 'plant_tall', 'plant_small', 'water_cooler', 'magazine_table',
  'fish_tank', 'kids_corner', 'espresso_machine', 'sterilizer', 'kiosk', 'ultrasonic_cart', 'xray_unit',
  'break_table', 'certificate', 'wall_tv', 'entrance_door', 'partition', 'tooth_sign', 'trash_bin', 'coat_rack',
] as const;

// People: child nodes named Body, Head, LegL, LegR, ArmL, ArmR with pivots at the joints (walk and sit
// animations rotate them). Tintable materials are named exactly Shirt, Pants, Hair, Skin, Scrubs.
export const PEOPLE_MODELS = ['char_adult', 'char_kid', 'char_senior', 'char_staff', 'char_dentist'] as const;

export const ALL_MODELS: string[] = [...MOUTH_MODELS, ...TOOL_MODELS, ...CLINIC_MODELS, ...PEOPLE_MODELS];

/** Shop thumbnails rendered by Blender: public/img/thumbs/<modelKey>.png (transparent, 256 px). */
export const thumbUrl = (modelKey: string) => imgUrl(`thumbs/${modelKey}.png`);

// ------------------------------------------------------------------ 2D (art-2d builder)
export type Mood = 'happy' | 'neutral' | 'pain' | 'wow';
export const portraitUrl = (archetype: ArchetypeId, mood: Mood = 'neutral') => imgUrl(`portraits/${archetype}_${mood}.webp`);
export const staffPortraitUrl = (n: number) => imgUrl(`staff/staff_${n}.webp`);
export const avatarUrl = (n: number) => imgUrl(`avatars/avatar_${n}.webp`);
export const BOSS_URL = imgUrl('boss.webp');
export const TITLE_BG_URL = imgUrl('title_bg.webp');
export const LOGO_URL = imgUrl('logo.webp');
export const AVATAR_COUNT = 4;

// ------------------------------------------------------------------ audio (audio builder)
export const SFX_KEYS = [
  // clean scene
  'scrape_1', 'scrape_2', 'scrape_3', 'crunch_pop', 'crack_big', 'flake', 'ultrasonic_loop', 'polish_loop',
  'suction_loop', 'rinse_loop', 'floss_snap', 'debris_pop', 'tooth_ding', 'sparkle', 'gag', 'ow', 'mmhm',
  'giggle', 'chatter', 'reassure', 'combo', 'perfect', 'star', 'splash',
  // clinic and UI
  'door_chime', 'cash', 'coins', 'ui_click', 'ui_tab', 'purchase', 'level_up', 'hire', 'error', 'day_end',
  'review_good', 'review_bad', 'notify',
] as const;
export const MUSIC_KEYS = ['music_title', 'music_clinic', 'music_clean'] as const;
export type SfxKey = typeof SFX_KEYS[number];
export type MusicKey = typeof MUSIC_KEYS[number];
