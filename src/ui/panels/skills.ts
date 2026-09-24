// Skills: three branch columns, node states learned / available / locked, points to spend.
import { store } from '../../core/store';
import type { SkillId } from '../../core/types';
import { SKILLS, SKILL_BRANCH_NAMES, skillById, type SkillBranch } from '../../data/skills';
import * as sim from '../../sim';
import { h } from '../dom';
import { confetti } from '../fx';
import { act } from '../game';
import { icon } from '../icons';
import type { PanelCtx, PanelInst } from '../panelhost';
import { attempt } from '../safe';
import { btn } from '../widgets';

const BRANCH_ICON: Record<SkillBranch, string> = { technique: 'scaler', bedside: 'heart', business: 'wallet' };
const BRANCHES: SkillBranch[] = ['technique', 'bedside', 'business'];

export function skillsPanel(_ctx: PanelCtx): PanelInst {
  return {
    title: 'Skills',
    icon: 'skills',
    aside: () => {
      const n = store.state.player.skillPoints;
      return h('div.panel-points', { class: { 'has-points': n > 0 } }, icon('skills'), h('span.num', String(n)), h('span', n === 1 ? 'point' : 'points'));
    },
    key: () => { const p = store.state.player; return `${p.skillPoints}|${p.level}|${p.skills.join(',')}`; },
    render() {
      const s = store.state;
      const status = (id: SkillId) => attempt(() => sim.skillStatus(s, id), s.player.skills.includes(id) ? 'learned' as const : 'locked' as const, 'skillStatus');
      const cols = BRANCHES.map((b) => {
        const nodes = SKILLS.filter((k) => k.branch === b);
        const learned = nodes.filter((k) => status(k.id) === 'learned').length;
        return h('div.skill-col', { 'data-branch': b },
          h('div.skill-col-head', h('div.skill-col-icon', icon(BRANCH_ICON[b])), h('div.grow', h('h3', SKILL_BRANCH_NAMES[b]), h('div.small.muted', `${learned} of ${nodes.length} learned`))),
          ...nodes.map((k) => {
            const st = status(k.id);
            const needs: string[] = [];
            if (s.player.level < k.minLevel) needs.push(`Level ${k.minLevel}`);
            if (k.requires && !s.player.skills.includes(k.requires)) needs.push(skillById(k.requires).name);
            const node = h('div.skill-node', { class: `is-${st}` },
              h('div.skill-dot', icon(st === 'learned' ? 'check' : st === 'locked' ? 'lock' : 'skills')),
              h('div.grow',
                h('div.skill-name', k.name),
                h('div.skill-text', k.text),
                st === 'locked' && needs.length ? h('div.skill-needs', icon('lock'), `Needs ${needs.join(' and ')}`) : null,
                k.requires && st !== 'locked' ? h('div.skill-after', `After ${skillById(k.requires).name}`) : null,
              ),
              st === 'available'
                ? btn('Learn', {
                  variant: 'primary', size: 'sm', disabled: s.player.skillPoints <= 0, title: s.player.skillPoints > 0 ? `Learn ${k.name}` : 'No skill points',
                  onClick: (ev) => { const t = ev.currentTarget as HTMLElement; if (act(() => sim.learnSkill(store.state, k.id), { sound: 'purchase', success: `${k.name} learned` })) confetti(t, 30); },
                })
                : null,
            );
            return node;
          }),
        );
      });
      return h('div.skills-panel',
        s.player.skillPoints > 0 ? null : h('div.skills-note.small.muted', icon('info'), 'You earn a skill point every level.'),
        h('div.skill-cols', ...cols),
      );
    },
  };
}
