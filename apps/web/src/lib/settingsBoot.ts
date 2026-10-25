/** Server-safe part of the settings module (no hooks): the storage key and the boot script. */
export const SETTINGS_KEY = "thoroughbred:settings";

/** Inline script (runs in <head>): applies saved text size / motion settings before the first paint. */
export const SETTINGS_BOOT_SCRIPT = `try{var s=JSON.parse(localStorage.getItem(${JSON.stringify(SETTINGS_KEY)})||"{}");var d=document.documentElement;if(s.text&&s.text!=="100")d.dataset.text=s.text;if(s.motion&&s.motion!=="system")d.dataset.motion=s.motion;}catch(e){}`;
