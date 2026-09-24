// Skills: four branch columns (Technique, Bedside, Business, Management), node states learned /
// available / locked with the level requirement, points to spend.
import { store } from '../../core/store';
import type { SkillId } from '../../core/types';
import { SKILLS, SKILL_BRANCH_NAMES, skillById, type Skill, type SkillBranch } from '../../data/skills';
import * as sim from '../../sim';
import { h } from '../dom';
import { confetti } from '../fx';
import { act } from '../game';
import { icon } from '../icons';
import type { PanelCtx, PanelInst } from '../panelhost';
import { attempt } from '../safe';
import { btn } from '../widgets';

const BRANCH_ICON: Record<SkillBranch, string> = { technique: 'scaler', bedside: 'heart', business: 'wallet', management: 'staff' };
const BRANCH_BLURB: Record<SkillBranch, string> = {
  technique: 'Your hands in the mouth',
  bedside: 'Calm, happy patients',
  business: 'Money in, costs down',
  management: 'Your team and your mornings',
};
const BRANCHES: SkillBranch[] = ['technique', 'bedside', 'business', 'management'];

/** Skills in tree order: roots first, each followed by what it unlocks. */
function treeOrder(nodes: Skill[]): Skill[] {
  const out: Skill[] = [];
  const add = (k: Skill) => {
    if (out.includes(k)) return;
    out.push(k);
    nodes.filter((x) => x.requires === k.id).sort((a, b) => a.minLevel - b.minLevel).forEach(add);
  };
  nodes.filter((k) => !k.requires || !nodes.some((x) => x.id === k.requires)).sort((a, b) => a.minLevel - b.minLevel).forEach(add);
  nodes.forEach(add);
  return out;
}

export function skillsPanel(_ctx: PanelCtx): PanelInst {
  return {
    title: 'Skills',
    icon: 'skills',
    aside: () => {
      const n = store.state.player.skillPoints;
      return h('div.panel-points', { class: { 'has-points': n > 0 } }, icon('skills'), h('span.num', String(n)), h('span', n === 1 ? 'point' : 'points'));
    },
    key: () => { const p = store.state.player; return `${p.skillPoints}|${p.level}|${p.skills.join(',')}|${store.state.phase}`; },
    render() {
      const s = store.state;
      const status = (id: SkillId) => attempt(() => sim.skillStatus(s, id), s.player.skills.includes(id) ? 'learned' as const : 'locked' as const, 'skillStatus');
      const cols = BRANCHES.map((b) => {
        const nodes = treeOrder(SKILLS.filter((k) => k.branch === b));
        const learned = nodes.filter((k) => status(k.id) === 'learned').length;
        return h('div.skill-col', { 'data-branch': b },
          h('div.skill-col-head',
            h('div.skill-col-icon', icon(BRANCH_ICON[b])),
            h('div.grow', h('h3', SKILL_BRANCH_NAMES[b]), h('div.small.muted', `${learned} of ${nodes.length} learned`)),
          ),
          h('div.skill-col-blurb.tiny.bold.faint', BRANCH_BLURB[b]),
          ...nodes.map((k) => {
            const st = status(k.id);
            const levelOk = s.player.level >= k.minLevel;
            const reqOk = !k.requires || s.player.skills.includes(k.requires);
            const needs: string[] = [];
            if (!levelOk) needs.push(`Level ${k.minLevel}`);
            if (!reqOk && k.requires) needs.push(skillById(k.requires).name);
            const child = !!k.requires && nodes.some((x) => x.id === k.requires);
            return h('div.skill-node', { class: [`is-${st}`, { 'is-child': child }], 'data-skill': k.id },
              h('div.skill-dot', icon(st === 'learned' ? 'check' : st === 'locked' ? 'lock' : 'skills')),
              h('div.grow',
                h('div.skill-name', k.name),
                h('div.skill-text', k.text),
                st === 'locked' && needs.length ? h('div.skill-needs', icon('lock'), `Needs ${needs.join(' and ')}`) : null,
                st !== 'locked' && st !== 'learned' ? h('div.skill-after', `Level ${k.minLevel}${k.requires ? `, after ${skillById(k.requires).name}` : ''}`) : null,
                st === 'available'
                  ? btn('Learn', {
                    variant: 'primary', size: 'sm', class: 'skill-learn', disabled: s.player.skillPoints <= 0, title: s.player.skillPoints > 0 ? `Learn ${k.name}` : 'No skill points',
                    onClick: (ev) => { const t = ev.currentTarget as HTMLElement; if (act(() => sim.learnSkill(store.state, k.id), { sound: 'purchase', success: `${k.name} learned` })) confetti(t, 30); },
                  })
                  : null,
              ),
            );
          }),
        );
      });
      // phones stack the branches: a row of chips jumps to each one
      const jump = h('div.skill-jump', ...BRANCHES.map((b) => {
        const avail = SKILLS.filter((k) => k.branch === b && status(k.id) === 'available').length;
        const x = h('button.chip.chip-btn', { type: 'button', 'data-jump': b }, icon(BRANCH_ICON[b]), SKILL_BRANCH_NAMES[b], avail && s.player.skillPoints > 0 ? h('span.badge', String(avail)) : null);
        x.addEventListener('click', (ev) => {
          const col = (ev.currentTarget as HTMLElement).closest('.skills-panel')?.querySelector(`.skill-col[data-branch='${b}']`);
          col?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        return x;
      }));
      return h('div.skills-panel',
        s.player.skillPoints > 0 ? null : h('div.skills-note.small.muted', icon('info'), s.phase === 'owner' ? 'You earn a skill point every level. Your team earns you XP too.' : 'You earn a skill point every level.'),
        jump,
        h('div.skill-cols', ...cols),
      );
    },
  };
}
