import type { PageIntroDef } from './types';

/**
 * One contextual intro per page area, shown the first time the user lands
 * there (not all at once). Order matters only when several match one route —
 * the first unseen match wins.
 */
export const PAGE_INTROS: PageIntroDef[] = [
  {
    id: 'chat',
    // Workspace gallery + a workspace's thread gallery.
    matchRoute: (p) => p === '/chat' || /^\/chat\/(?!t\/)[^/]+$/.test(p),
    steps: [
      {
        id: 'modes',
        titleKey: 'agents.tour.modes.title',
        bodyKey: 'agents.tour.modes.body',
        visual: 'twoModes',
      },
      {
        id: 'chiefOfStaff',
        titleKey: 'agents.tour.chiefOfStaff.title',
        bodyKey: 'agents.tour.chiefOfStaff.body',
        visual: 'chiefOfStaffAnswer',
        // It answers from iMessage, and chat apps link through the hosted platform.
        platformOnly: true,
      },
      {
        id: 'ptc',
        titleKey: 'agents.tour.analyst.title',
        bodyKey: 'agents.tour.analyst.body',
        visual: 'ptcSandbox',
      },
      {
        id: 'workspace',
        titleKey: 'onboarding.intros.chat.steps.workspace.title',
        bodyKey: 'agents.tour.workspace.body',
        visual: 'workspaceGrid',
      },
      {
        id: 'create',
        titleKey: 'agents.tour.create.title',
        bodyKey: 'agents.tour.create.body',
        visual: 'createWorkspace',
      },
    ],
  },
  {
    id: 'thread',
    // Any real thread; the personalization chat (__default__) keeps its own flow.
    matchRoute: (p) => /^\/chat\/t\/(?!__default__)/.test(p),
    steps: [
      {
        id: 'filePanel',
        titleKey: 'onboarding.intros.thread.steps.filePanel.title',
        bodyKey: 'onboarding.intros.thread.steps.filePanel.body',
        visual: 'filePanel',
      },
      {
        id: 'chart',
        titleKey: 'onboarding.intros.thread.steps.chart.title',
        bodyKey: 'onboarding.intros.thread.steps.chart.body',
        visual: 'chartPanel',
      },
      {
        id: 'memory',
        titleKey: 'onboarding.intros.thread.steps.memory.title',
        bodyKey: 'onboarding.intros.thread.steps.memory.body',
        visual: 'memory',
      },
      {
        id: 'memo',
        titleKey: 'onboarding.intros.thread.steps.memo.title',
        bodyKey: 'onboarding.intros.thread.steps.memo.body',
        visual: 'memo',
      },
      {
        id: 'share',
        titleKey: 'onboarding.intros.thread.steps.share.title',
        bodyKey: 'onboarding.intros.thread.steps.share.body',
        visual: 'shareThread',
      },
    ],
  },
  {
    id: 'dashboard',
    matchRoute: (p) => p === '/dashboard',
    steps: [
      {
        id: 'overview',
        titleKey: 'onboarding.intros.dashboard.steps.overview.title',
        bodyKey: 'onboarding.intros.dashboard.steps.overview.body',
        visual: 'dashboardGrid',
      },
      {
        id: 'customize',
        titleKey: 'onboarding.intros.dashboard.steps.customize.title',
        bodyKey: 'onboarding.intros.dashboard.steps.customize.body',
        visual: 'dashboardCustomize',
      },
      {
        id: 'attach',
        titleKey: 'onboarding.intros.dashboard.steps.attach.title',
        bodyKey: 'onboarding.intros.dashboard.steps.attach.body',
        visual: 'dashboardAttach',
      },
    ],
  },
  {
    id: 'market',
    matchRoute: (p) => p === '/market',
    steps: [
      {
        id: 'ask',
        titleKey: 'onboarding.intros.market.steps.ask.title',
        bodyKey: 'onboarding.intros.market.steps.ask.body',
        visual: 'marketAsk',
      },
      {
        id: 'draw',
        titleKey: 'onboarding.intros.market.steps.draw.title',
        bodyKey: 'onboarding.intros.market.steps.draw.body',
        visual: 'marketDraw',
      },
    ],
  },
  {
    id: 'automations',
    matchRoute: (p) => p === '/automations',
    steps: [
      {
        id: 'trigger',
        titleKey: 'onboarding.intros.automations.steps.trigger.title',
        bodyKey: 'onboarding.intros.automations.steps.trigger.body',
        visual: 'automationTrigger',
      },
      {
        id: 'ask',
        titleKey: 'onboarding.intros.automations.steps.ask.title',
        bodyKey: 'onboarding.intros.automations.steps.ask.body',
        visual: 'automationAsk',
      },
      {
        id: 'feed',
        titleKey: 'onboarding.intros.automations.steps.feed.title',
        bodyKey: 'onboarding.intros.automations.steps.feed.body',
        visual: 'automationFeed',
      },
      {
        id: 'delivery',
        titleKey: 'onboarding.intros.automations.steps.delivery.title',
        bodyKey: 'onboarding.intros.automations.steps.delivery.body',
        visual: 'automationDelivery',
        // Chat apps link through the hosted platform.
        platformOnly: true,
      },
    ],
  },
];
