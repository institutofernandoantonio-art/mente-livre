export const handlers = {
  startCalendarReschedule: async () => ({ status: 'error' }),
  handleCalendarRescheduleRuntime: async () => ({ status: 'not_applicable' }),
};

export async function startCalendarReschedule(...args) {
  return handlers.startCalendarReschedule(...args);
}

export async function handleCalendarRescheduleRuntime(...args) {
  return handlers.handleCalendarRescheduleRuntime(...args);
}
