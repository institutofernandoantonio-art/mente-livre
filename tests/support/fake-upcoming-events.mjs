function unconfigured(name) {
  return async (...args) => {
    throw new Error(`${name} (dublê) não foi configurado — ${JSON.stringify(args)}`);
  };
}

export const handlers = {
  getGoogleCalendarEventsInWindow: unconfigured('getGoogleCalendarEventsInWindow'),
};

export async function getGoogleCalendarEventsInWindow(...args) {
  return handlers.getGoogleCalendarEventsInWindow(...args);
}
