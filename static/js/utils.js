export const esc = v => String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const pad = n => String(n).padStart(2,'0');
export const t = v => Date.parse(v);
export function clock(value,zone='UTC',seconds=false) {return new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',...(seconds?{second:'2-digit'}:{}),hour12:false,timeZone:zone}).format(new Date(value));}
export function day(value,zone='UTC') {return new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:zone}).format(new Date(value));}
export const utcInput = value => new Date(value).toISOString().slice(0,16);
export const fromInput = value => new Date(`${value}:00Z`).toISOString();
export const minutes = n => Number((n/60).toFixed(1));
export const nice = n => new Intl.NumberFormat('en-GB',{maximumFractionDigits:1}).format(n??0);
export const percent = (n,d) => d?Math.round(n/d*100):0;
export const fmtCoords = (lat,lon) => `${Math.abs(lat).toFixed(1)}°${lat<0?'S':'N'} / ${Math.abs(lon).toFixed(1)}°${lon<0?'W':'E'}`;
export const icon = name => {
 const paths={arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>',diagonal:'<path d="M6 18 18 6M6 6h12v12"/>',download:'<path d="M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',plus:'<path d="M12 5v14M5 12h14"/>',minus:'<path d="M5 12h14"/>',menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',reset:'<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',globe:'<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',schedule:'<rect x="3" y="4" width="18" height="16"/><path d="M7 2v4M17 2v4M3 9h18M7 13h4M13 16h4"/>',recover:'<path d="M4 7h10l-3-3m3 3-3 3M20 17H10l3 3m-3-3 3-3M4 7v10h3M20 17V7h-3"/>',requests:'<path d="M6 3h12v18H6zM9 7h6M9 11h6M9 15h4"/>',station:'<path d="m5 4 14 14M4 5c-2 7 8 17 15 13M11 16l-3 5h12l-4-7M13 3a8 8 0 0 1 8 8M13 7a4 4 0 0 1 4 4"/>',chart:'<path d="M4 3v18h17M8 16v-5M13 16V6M18 16v-8"/>',data:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',log:'<path d="M5 4h14v16H5zM9 8h6M9 12h6M9 16h4"/>',check:'<path d="m5 12 4 4L19 6"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/>',lock:'<rect x="5" y="10" width="14" height="11"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',play:'<path d="m8 5 11 7-11 7z"/>',pause:'<path d="M8 5v14M16 5v14"/>',upload:'<path d="M12 16V3m-4 4 4-4 4 4M4 17v4h16v-4"/>'};
 return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${paths[name]||paths.info}</svg>`;
};
export const logo = () => '<svg class="brand-mark" viewBox="0 0 44 44" fill="none" aria-hidden="true"><path d="M11 32V11h14l7 7-7 7H11" stroke="currentColor" stroke-width="2"/><ellipse cx="22" cy="22" rx="22" ry="8" transform="rotate(-48 22 22)" stroke="currentColor" stroke-width="1.2"/><path d="m25 25 8 8" stroke="currentColor" stroke-width="2"/></svg>';
