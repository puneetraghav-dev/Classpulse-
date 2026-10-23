// Test-only stand-in for the Google Meet add-ons SDK. An "activity" started in one tab is seen by others.
window.meet = {
  addon: {
    createAddonSession: async ({ cloudProjectNumber }) => {
      window.__meetProject = cloudProjectNumber;
      const client = {
        getActivityStartingState: async () => {
          const s = localStorage.getItem('mock-meet-activity');
          if (!s) throw new Error('No activity has started');
          return JSON.parse(s);
        },
        startActivity: async st => { localStorage.setItem('mock-meet-activity', JSON.stringify(st)); window.__meetStarted = st; },
      };
      return { createSidePanelClient: async () => client, createMainStageClient: async () => client };
    },
  },
};
