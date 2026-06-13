module.exports = [
"[project]/src/api/client.ts [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "ApiError",
    ()=>ApiError,
    "api",
    ()=>api,
    "apiRequest",
    ()=>apiRequest,
    "detailMessage",
    ()=>detailMessage
]);
const API_PREFIX = '/api';
const CSRF_COOKIE = 'inventorymgr_csrf';
function readCookie(name) {
    const prefix = `${encodeURIComponent(name)}=`;
    for (const part of document.cookie.split(';')){
        const value = part.trim();
        if (value.startsWith(prefix)) {
            return decodeURIComponent(value.slice(prefix.length));
        }
    }
    return null;
}
function isStateChanging(method) {
    return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
}
class ApiError extends Error {
    status;
    detail;
    constructor(status, detail){
        super(typeof detail === 'string' ? detail : `Request failed with status ${status}`);
        this.name = 'ApiError';
        this.status = status;
        this.detail = detail;
    }
}
async function parseResponse(response) {
    if (response.status === 204) {
        return null;
    }
    const text = await response.text();
    if (!text) {
        return null;
    }
    try {
        return JSON.parse(text);
    } catch  {
        return text;
    }
}
async function apiRequest(path, options = {}) {
    const method = (options.method ?? 'GET').toUpperCase();
    const headers = new Headers(options.headers);
    if (!(options.body instanceof FormData) && options.body !== undefined && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }
    if (isStateChanging(method)) {
        const token = readCookie(CSRF_COOKIE);
        if (token) {
            headers.set('X-CSRF-Token', token);
        }
    }
    const response = await fetch(`${API_PREFIX}${path}`, {
        ...options,
        method,
        headers,
        credentials: 'include'
    });
    const data = await parseResponse(response);
    if (!response.ok) {
        const detail = typeof data === 'object' && data !== null && 'detail' in data ? data.detail : data;
        throw new ApiError(response.status, detail);
    }
    return data;
}
function detailMessage(error) {
    if (error instanceof ApiError) {
        if (typeof error.detail === 'string') return error.detail;
        if (Array.isArray(error.detail)) {
            return error.detail.map((item)=>{
                if (typeof item === 'string') return item;
                if (item && typeof item === 'object' && 'msg' in item) return String(item.msg);
                return 'Request validation failed';
            }).join('; ');
        }
    }
    return error instanceof Error ? error.message : 'Unexpected error';
}
const api = {
    setupStatus: ()=>apiRequest('/auth/setup'),
    setupAdmin: (email, password)=>apiRequest('/auth/setup', {
            method: 'POST',
            body: JSON.stringify({
                email,
                password
            })
        }),
    login: (email, password)=>apiRequest('/auth/login', {
            method: 'POST',
            body: JSON.stringify({
                email,
                password
            })
        }),
    logout: ()=>apiRequest('/auth/logout', {
            method: 'POST'
        }),
    me: ()=>apiRequest('/auth/me'),
    listUsers: ()=>apiRequest('/users'),
    createUser: (payload)=>apiRequest('/users', {
            method: 'POST',
            body: JSON.stringify(payload)
        }),
    updateUser: (id, payload)=>apiRequest(`/users/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(payload)
        }),
    listVms: (params)=>apiRequest(`/vms?${params.toString()}`),
    getVm: (id)=>apiRequest(`/vms/${id}`),
    createVm: (payload)=>apiRequest('/vms', {
            method: 'POST',
            body: JSON.stringify(payload)
        }),
    updateVm: (id, payload)=>apiRequest(`/vms/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(payload)
        }),
    deleteVm: (id)=>apiRequest(`/vms/${id}`, {
            method: 'DELETE'
        }),
    previewImport: (file)=>{
        const body = new FormData();
        body.set('file', file);
        return apiRequest('/imports/preview', {
            method: 'POST',
            body
        });
    },
    getImport: (id)=>apiRequest(`/imports/${id}`),
    commitImport: (id)=>apiRequest(`/imports/${id}/commit`, {
            method: 'POST'
        })
};
}),
"[project]/src/lib/classNames.ts [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "cn",
    ()=>cn
]);
function cn(...classes) {
    return classes.filter(Boolean).join(' ');
}
}),
"[project]/src/components/ui.tsx [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "Alert",
    ()=>Alert,
    "Badge",
    ()=>Badge,
    "EmptyState",
    ()=>EmptyState,
    "FieldError",
    ()=>FieldError,
    "PageHeader",
    ()=>PageHeader,
    "cardClass",
    ()=>cardClass,
    "dangerButtonClass",
    ()=>dangerButtonClass,
    "inputClass",
    ()=>inputClass,
    "primaryButtonClass",
    ()=>primaryButtonClass,
    "secondaryButtonClass",
    ()=>secondaryButtonClass,
    "selectClass",
    ()=>selectClass,
    "tableWrapClass",
    ()=>tableWrapClass,
    "textareaClass",
    ()=>textareaClass
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$classNames$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/classNames.ts [app-ssr] (ecmascript)");
;
;
const primaryButtonClass = 'inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60';
const secondaryButtonClass = 'inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60';
const dangerButtonClass = 'inline-flex items-center justify-center rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60';
const inputClass = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 shadow-sm transition placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:bg-slate-100';
const selectClass = inputClass;
const textareaClass = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$classNames$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["cn"])(inputClass, 'min-h-28 resize-y');
const cardClass = 'rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-sm backdrop-blur';
const tableWrapClass = 'overflow-x-auto rounded-2xl border border-slate-200/80 bg-white/90 shadow-sm';
const alertTones = {
    error: 'border-red-200 bg-red-50 text-red-800',
    info: 'border-blue-200 bg-blue-50 text-blue-800',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800'
};
const badgeTone = {
    running: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    create: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    low: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    active: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    stopped: 'border-red-200 bg-red-50 text-red-700',
    invalid: 'border-red-200 bg-red-50 text-red-700',
    critical: 'border-red-200 bg-red-50 text-red-700',
    suspended: 'border-amber-200 bg-amber-50 text-amber-700',
    conflict: 'border-amber-200 bg-amber-50 text-amber-700',
    high: 'border-amber-200 bg-amber-50 text-amber-700',
    retiring: 'border-amber-200 bg-amber-50 text-amber-700',
    unknown: 'border-blue-200 bg-blue-50 text-blue-700',
    update: 'border-blue-200 bg-blue-50 text-blue-700',
    medium: 'border-blue-200 bg-blue-50 text-blue-700',
    planned: 'border-violet-200 bg-violet-50 text-violet-700',
    retired: 'border-slate-200 bg-slate-100 text-slate-700'
};
function PageHeader({ title, actions, eyebrow }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: "mb-6 grid gap-4 sm:flex sm:items-end sm:justify-between",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                children: [
                    eyebrow ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                        className: "text-xs font-semibold uppercase tracking-[0.2em] text-blue-600",
                        children: eyebrow
                    }, void 0, false, {
                        fileName: "[project]/src/components/ui.tsx",
                        lineNumber: 42,
                        columnNumber: 20
                    }, this) : null,
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("h1", {
                        className: "mt-1 text-3xl font-semibold tracking-tight text-slate-950",
                        children: title
                    }, void 0, false, {
                        fileName: "[project]/src/components/ui.tsx",
                        lineNumber: 43,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/src/components/ui.tsx",
                lineNumber: 41,
                columnNumber: 7
            }, this),
            actions ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "flex flex-wrap gap-2",
                children: actions
            }, void 0, false, {
                fileName: "[project]/src/components/ui.tsx",
                lineNumber: 45,
                columnNumber: 18
            }, this) : null
        ]
    }, void 0, true, {
        fileName: "[project]/src/components/ui.tsx",
        lineNumber: 40,
        columnNumber: 5
    }, this);
}
function Alert({ children, tone = 'error' }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$classNames$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["cn"])('my-4 rounded-xl border px-4 py-3 text-sm font-medium shadow-sm', alertTones[tone]),
        role: tone === 'error' ? 'alert' : 'status',
        children: children
    }, void 0, false, {
        fileName: "[project]/src/components/ui.tsx",
        lineNumber: 52,
        columnNumber: 5
    }, this);
}
function FieldError({ id, message }) {
    if (!message) return null;
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
        id: id,
        className: "mt-1 text-sm font-medium text-red-700",
        children: message
    }, void 0, false, {
        fileName: "[project]/src/components/ui.tsx",
        lineNumber: 61,
        columnNumber: 5
    }, this);
}
function Badge({ value }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
        className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$classNames$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["cn"])('inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold capitalize', badgeTone[value] ?? 'border-slate-200 bg-slate-100 text-slate-700'),
        children: value
    }, void 0, false, {
        fileName: "[project]/src/components/ui.tsx",
        lineNumber: 68,
        columnNumber: 10
    }, this);
}
function EmptyState({ title, body }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: "rounded-2xl border border-dashed border-slate-300 bg-white/70 p-10 text-center shadow-sm",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("h2", {
                className: "text-lg font-semibold text-slate-950",
                children: title
            }, void 0, false, {
                fileName: "[project]/src/components/ui.tsx",
                lineNumber: 74,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                className: "mt-2 text-sm text-slate-600",
                children: body
            }, void 0, false, {
                fileName: "[project]/src/components/ui.tsx",
                lineNumber: 75,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/src/components/ui.tsx",
        lineNumber: 73,
        columnNumber: 5
    }, this);
}
}),
"[project]/src/components/AuthContext.tsx [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "CurrentUserProvider",
    ()=>CurrentUserProvider,
    "RoleGate",
    ()=>RoleGate,
    "useCurrentUser",
    ()=>useCurrentUser
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/ui.tsx [app-ssr] (ecmascript)");
'use client';
;
;
;
const CurrentUserContext = /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["createContext"])(null);
function CurrentUserProvider({ user, children }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(CurrentUserContext.Provider, {
        value: user,
        children: children
    }, void 0, false, {
        fileName: "[project]/src/components/AuthContext.tsx",
        lineNumber: 10,
        columnNumber: 10
    }, this);
}
function useCurrentUser() {
    const user = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useContext"])(CurrentUserContext);
    if (!user) throw new Error('useCurrentUser must be used inside CurrentUserProvider');
    return user;
}
function RoleGate({ allowed, message, children }) {
    const user = useCurrentUser();
    return allowed.includes(user.role) ? children : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Alert"], {
        children: message
    }, void 0, false, {
        fileName: "[project]/src/components/AuthContext.tsx",
        lineNumber: 29,
        columnNumber: 51
    }, this);
}
}),
"[project]/src/components/AppNav.tsx [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "AppNav",
    ()=>AppNav,
    "buildNavItems",
    ()=>buildNavItems,
    "canSeeUsers",
    ()=>canSeeUsers
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/client/app-dir/link.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$navigation$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/navigation.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$classNames$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/classNames.ts [app-ssr] (ecmascript)");
'use client';
;
;
;
;
function canSeeUsers(role) {
    return role === 'admin';
}
function buildNavItems(user) {
    return [
        {
            to: '/inventory',
            label: 'Inventory',
            visible: true
        },
        {
            to: '/imports/new',
            label: 'CSV Import',
            visible: user.role === 'admin' || user.role === 'editor'
        },
        {
            to: '/users',
            label: 'Users',
            visible: canSeeUsers(user.role)
        }
    ];
}
function AppNav({ user }) {
    const pathname = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$navigation$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["usePathname"])();
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("nav", {
        className: "mt-4 flex gap-2 overflow-x-auto lg:mt-8 lg:flex-col lg:overflow-visible",
        "aria-label": "Primary",
        children: buildNavItems(user).filter((item)=>item.visible).map((item)=>{
            const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
            return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["default"], {
                href: item.to,
                className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$classNames$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["cn"])('rounded-xl px-3 py-2.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2', active ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:-translate-y-0.5 hover:bg-slate-100 hover:text-slate-950'),
                children: item.label
            }, item.to, false, {
                fileName: "[project]/src/components/AppNav.tsx",
                lineNumber: 36,
                columnNumber: 13
            }, this);
        })
    }, void 0, false, {
        fileName: "[project]/src/components/AppNav.tsx",
        lineNumber: 30,
        columnNumber: 5
    }, this);
}
}),
"[project]/src/components/Layout.tsx [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "AppLayout",
    ()=>AppLayout
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$useMutation$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@tanstack/react-query/build/modern/useMutation.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$QueryClientProvider$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@tanstack/react-query/build/modern/QueryClientProvider.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$navigation$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/navigation.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$api$2f$client$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/api/client.ts [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/ui.tsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$AppNav$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/AppNav.tsx [app-ssr] (ecmascript)");
'use client';
;
;
;
;
;
;
function AppLayout({ user, children }) {
    const router = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$navigation$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRouter"])();
    const queryClient = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$QueryClientProvider$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useQueryClient"])();
    const logout = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$useMutation$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useMutation"])({
        mutationFn: __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$api$2f$client$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["api"].logout,
        onSettled: ()=>{
            queryClient.clear();
            router.replace('/login');
        }
    });
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: "min-h-screen bg-slate-50 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.12),transparent_32rem),radial-gradient(circle_at_bottom_right,rgba(79,70,229,0.10),transparent_30rem)] lg:flex",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("aside", {
                className: "border-b border-slate-200/80 bg-white/90 px-4 py-4 shadow-sm backdrop-blur lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-72 lg:flex-col lg:border-b-0 lg:border-r lg:px-6 lg:py-6",
                "aria-label": "Primary navigation",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "flex items-center justify-between gap-4 lg:block",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "text-lg font-bold tracking-tight text-slate-950",
                                children: "InventoryMGR"
                            }, void 0, false, {
                                fileName: "[project]/src/components/Layout.tsx",
                                lineNumber: 30,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "lg:hidden",
                                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                                    type: "button",
                                    className: __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["secondaryButtonClass"],
                                    onClick: ()=>logout.mutate(),
                                    disabled: logout.isPending,
                                    children: logout.isPending ? 'Signing out…' : 'Logout'
                                }, void 0, false, {
                                    fileName: "[project]/src/components/Layout.tsx",
                                    lineNumber: 32,
                                    columnNumber: 13
                                }, this)
                            }, void 0, false, {
                                fileName: "[project]/src/components/Layout.tsx",
                                lineNumber: 31,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/src/components/Layout.tsx",
                        lineNumber: 29,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$AppNav$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["AppNav"], {
                        user: user
                    }, void 0, false, {
                        fileName: "[project]/src/components/Layout.tsx",
                        lineNumber: 37,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "mt-4 hidden rounded-2xl border border-slate-200 bg-slate-50 p-4 lg:mt-auto lg:block",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "mb-3 min-w-0",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                        className: "block truncate text-sm font-medium text-slate-700",
                                        children: user.email
                                    }, void 0, false, {
                                        fileName: "[project]/src/components/Layout.tsx",
                                        lineNumber: 40,
                                        columnNumber: 13
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("strong", {
                                        className: "mt-1 inline-flex rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700",
                                        children: user.role
                                    }, void 0, false, {
                                        fileName: "[project]/src/components/Layout.tsx",
                                        lineNumber: 41,
                                        columnNumber: 13
                                    }, this)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/src/components/Layout.tsx",
                                lineNumber: 39,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                                type: "button",
                                className: __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["secondaryButtonClass"] + ' w-full',
                                onClick: ()=>logout.mutate(),
                                disabled: logout.isPending,
                                children: logout.isPending ? 'Signing out…' : 'Logout'
                            }, void 0, false, {
                                fileName: "[project]/src/components/Layout.tsx",
                                lineNumber: 43,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/src/components/Layout.tsx",
                        lineNumber: 38,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/src/components/Layout.tsx",
                lineNumber: 28,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("main", {
                className: "px-4 py-6 sm:px-6 lg:ml-72 lg:min-h-screen lg:flex-1 lg:px-8 lg:py-8",
                tabIndex: -1,
                children: children
            }, void 0, false, {
                fileName: "[project]/src/components/Layout.tsx",
                lineNumber: 48,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/src/components/Layout.tsx",
        lineNumber: 27,
        columnNumber: 5
    }, this);
}
}),
"[project]/src/app/(app)/layout.tsx [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>AuthenticatedLayout
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$useQuery$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@tanstack/react-query/build/modern/useQuery.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$navigation$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/navigation.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$api$2f$client$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/api/client.ts [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$AuthContext$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/AuthContext.tsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$Layout$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/Layout.tsx [app-ssr] (ecmascript)");
'use client';
;
;
;
;
;
;
;
function AuthenticatedLayout({ children }) {
    const router = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$navigation$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRouter"])();
    const me = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$useQuery$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useQuery"])({
        queryKey: [
            'me'
        ],
        queryFn: __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$api$2f$client$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["api"].me
    });
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        if (me.isError || !me.isLoading && !me.data) {
            router.replace('/login');
        }
    }, [
        me.data,
        me.isError,
        me.isLoading,
        router
    ]);
    if (me.isLoading) {
        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
            className: "p-6",
            role: "status",
            children: "Loading session…"
        }, void 0, false, {
            fileName: "[project]/src/app/(app)/layout.tsx",
            lineNumber: 21,
            columnNumber: 12
        }, this);
    }
    if (me.isError || !me.data) {
        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
            className: "p-6",
            role: "status",
            children: "Redirecting…"
        }, void 0, false, {
            fileName: "[project]/src/app/(app)/layout.tsx",
            lineNumber: 25,
            columnNumber: 12
        }, this);
    }
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$AuthContext$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["CurrentUserProvider"], {
        user: me.data,
        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$Layout$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["AppLayout"], {
            user: me.data,
            children: children
        }, void 0, false, {
            fileName: "[project]/src/app/(app)/layout.tsx",
            lineNumber: 30,
            columnNumber: 7
        }, this)
    }, void 0, false, {
        fileName: "[project]/src/app/(app)/layout.tsx",
        lineNumber: 29,
        columnNumber: 5
    }, this);
}
}),
];

//# sourceMappingURL=src_0wjprat._.js.map