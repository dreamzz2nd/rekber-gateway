export const logger = {
  info: (arg1: any, arg2?: any) => {
    if (typeof arg1 === 'string') {
      console.log(`[INFO] ${new Date().toLocaleTimeString()} - ${arg1}`, arg2 || '');
    } else {
      console.log(`[INFO] ${new Date().toLocaleTimeString()} - ${arg2 || ''}`, JSON.stringify(arg1));
    }
  },
  debug: (arg1: any, arg2?: any) => {
    if (typeof arg1 === 'string') {
      console.log(`[DEBUG] ${new Date().toLocaleTimeString()} - ${arg1}`, arg2 || '');
    } else {
      console.log(`[DEBUG] ${new Date().toLocaleTimeString()} - ${arg2 || ''}`, JSON.stringify(arg1));
    }
  },
  warn: (arg1: any, arg2?: any) => {
    if (typeof arg1 === 'string') {
      console.warn(`[WARN] ${new Date().toLocaleTimeString()} - ${arg1}`, arg2 || '');
    } else {
      console.warn(`[WARN] ${new Date().toLocaleTimeString()} - ${arg2 || ''}`, JSON.stringify(arg1));
    }
  },
  error: (arg1: any, arg2?: any) => {
    if (typeof arg1 === 'string') {
      console.error(`[ERROR] ${new Date().toLocaleTimeString()} - ${arg1}`, arg2 || '');
    } else {
      console.error(`[ERROR] ${new Date().toLocaleTimeString()} - ${arg2 || ''}`, JSON.stringify(arg1));
    }
  },
  fatal: (arg1: any, arg2?: any) => {
    console.error(`[FATAL] ${new Date().toLocaleTimeString()} -`, arg1, arg2 || '');
  },
};
