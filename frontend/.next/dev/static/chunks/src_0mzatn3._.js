(globalThis["TURBOPACK"] || (globalThis["TURBOPACK"] = [])).push([typeof document === "object" ? document.currentScript : undefined,
"[project]/src/lib/vmForm.ts [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "collectErrors",
    ()=>collectErrors,
    "createDefaultVmFormValues",
    ()=>createDefaultVmFormValues,
    "criticalities",
    ()=>criticalities,
    "emptyVmFormValues",
    ()=>emptyVmFormValues,
    "lifecycles",
    ()=>lifecycles,
    "platforms",
    ()=>platforms,
    "statuses",
    ()=>statuses,
    "validateVmFormInput",
    ()=>validateVmFormInput,
    "vmFormSchema",
    ()=>vmFormSchema,
    "vmToFormValues",
    ()=>vmToFormValues
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__ = __turbopack_context__.i("[project]/node_modules/zod/v4/classic/external.js [app-client] (ecmascript) <export * as z>");
;
const platforms = [
    'proxmox',
    'vmware'
];
const statuses = [
    'running',
    'stopped',
    'suspended',
    'unknown'
];
const criticalities = [
    'low',
    'medium',
    'high',
    'critical'
];
const lifecycles = [
    'planned',
    'active',
    'retiring',
    'retired'
];
const optionalText = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().transform((value)=>{
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
});
const requiredText = (label)=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().transform((value)=>value.trim()).pipe(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(1, `${label} is required.`));
const nonNegativeInteger = (label)=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].coerce.number().int(`${label} must be a whole number.`).min(0, `${label} must be 0 or greater.`);
const vmFormSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    name: requiredText('Name'),
    platform: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum(platforms),
    environment: requiredText('Environment'),
    datacenter: optionalText,
    cluster: requiredText('Cluster'),
    host: requiredText('Host'),
    external_id: optionalText,
    status: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum(statuses),
    cpu_cores: nonNegativeInteger('CPU cores'),
    memory_mb: nonNegativeInteger('Memory MB'),
    disk_gb: nonNegativeInteger('Disk GB'),
    os_name: optionalText,
    ip_addresses: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().transform(splitList),
    owner: optionalText,
    notes: optionalText,
    backup_status: optionalText,
    ha_enabled: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].boolean(),
    dr_tier: optionalText,
    criticality: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum(criticalities),
    lifecycle: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum(lifecycles),
    tags: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().transform(splitList),
    last_verified_at: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().transform((value, context)=>{
        const trimmed = value.trim();
        if (trimmed.length === 0) return null;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
            context.addIssue({
                code: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].ZodIssueCode.custom,
                message: 'Last verified date must use YYYY-MM-DD.'
            });
            return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].NEVER;
        }
        return trimmed;
    })
});
function splitList(value) {
    return value.split(';').map((item)=>item.trim()).filter((item)=>item.length > 0);
}
function emptyVmFormValues() {
    return {
        name: '',
        platform: 'proxmox',
        environment: '',
        datacenter: '',
        cluster: '',
        host: '',
        external_id: '',
        status: 'unknown',
        cpu_cores: 0,
        memory_mb: 0,
        disk_gb: 0,
        os_name: '',
        ip_addresses: '',
        owner: '',
        notes: '',
        backup_status: '',
        ha_enabled: false,
        dr_tier: '',
        criticality: 'medium',
        lifecycle: 'active',
        tags: '',
        last_verified_at: ''
    };
}
const createDefaultVmFormValues = emptyVmFormValues;
function validateVmFormInput(values) {
    const parsed = vmFormSchema.safeParse(values);
    if (!parsed.success) {
        return {
            ok: false,
            errors: collectErrors(parsed.error)
        };
    }
    return {
        ok: true,
        data: parsed.data,
        errors: {}
    };
}
function vmToFormValues(vm) {
    return {
        name: vm.name,
        platform: vm.platform,
        environment: vm.environment,
        datacenter: vm.datacenter ?? '',
        cluster: vm.cluster,
        host: vm.host,
        external_id: vm.external_id ?? '',
        status: vm.status,
        cpu_cores: vm.cpu_cores,
        memory_mb: vm.memory_mb,
        disk_gb: vm.disk_gb,
        os_name: vm.os_name ?? '',
        ip_addresses: vm.ip_addresses.join('; '),
        owner: vm.owner ?? '',
        notes: vm.notes ?? '',
        backup_status: vm.backup_status ?? '',
        ha_enabled: vm.ha_enabled,
        dr_tier: vm.dr_tier ?? '',
        criticality: vm.criticality,
        lifecycle: vm.lifecycle,
        tags: vm.tags.join('; '),
        last_verified_at: vm.last_verified_at ?? ''
    };
}
function collectErrors(error) {
    const errors = {};
    for (const issue of error.issues){
        const key = issue.path[0];
        if (key && !errors[key]) errors[key] = issue.message;
    }
    return errors;
}
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/src/routes/VmFormPage.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "VmFormPage",
    ()=>VmFormPage
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$useMutation$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@tanstack/react-query/build/modern/useMutation.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$useQuery$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@tanstack/react-query/build/modern/useQuery.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$QueryClientProvider$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@tanstack/react-query/build/modern/QueryClientProvider.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/client/app-dir/link.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$navigation$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/navigation.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$api$2f$client$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/api/client.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/ui.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$vmForm$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/vmForm.ts [app-client] (ecmascript)");
;
var _s = __turbopack_context__.k.signature();
'use client';
;
;
;
;
;
;
;
function TextInput({ name, label, values, errors, onChange, required = false, type = 'text' }) {
    const errorId = `${String(name)}-error`;
    const value = values[name];
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("label", {
                className: "mb-1 block text-sm font-medium text-slate-700",
                htmlFor: String(name),
                children: [
                    label,
                    required ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        "aria-hidden": "true",
                        children: " *"
                    }, void 0, false, {
                        fileName: "[project]/src/routes/VmFormPage.tsx",
                        lineNumber: 16,
                        columnNumber: 114
                    }, this) : null
                ]
            }, void 0, true, {
                fileName: "[project]/src/routes/VmFormPage.tsx",
                lineNumber: 16,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("input", {
                className: __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["inputClass"],
                id: String(name),
                name: String(name),
                type: type,
                value: typeof value === 'boolean' ? '' : value,
                onChange: (event)=>onChange(name, event.target.value),
                "aria-describedby": errors[name] ? errorId : undefined,
                "aria-invalid": Boolean(errors[name])
            }, void 0, false, {
                fileName: "[project]/src/routes/VmFormPage.tsx",
                lineNumber: 17,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["FieldError"], {
                id: errorId,
                message: errors[name]
            }, void 0, false, {
                fileName: "[project]/src/routes/VmFormPage.tsx",
                lineNumber: 18,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/src/routes/VmFormPage.tsx",
        lineNumber: 15,
        columnNumber: 5
    }, this);
}
_c = TextInput;
function SelectInput({ name, label, values, errors, onChange, options, required = false }) {
    const errorId = `${String(name)}-error`;
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("label", {
                className: "mb-1 block text-sm font-medium text-slate-700",
                htmlFor: String(name),
                children: [
                    label,
                    required ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        "aria-hidden": "true",
                        children: " *"
                    }, void 0, false, {
                        fileName: "[project]/src/routes/VmFormPage.tsx",
                        lineNumber: 27,
                        columnNumber: 114
                    }, this) : null
                ]
            }, void 0, true, {
                fileName: "[project]/src/routes/VmFormPage.tsx",
                lineNumber: 27,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("select", {
                className: __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["selectClass"],
                id: String(name),
                name: String(name),
                value: String(values[name]),
                onChange: (event)=>onChange(name, event.target.value),
                "aria-describedby": errors[name] ? errorId : undefined,
                "aria-invalid": Boolean(errors[name]),
                children: options.map((option)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("option", {
                        value: option,
                        children: option
                    }, option, false, {
                        fileName: "[project]/src/routes/VmFormPage.tsx",
                        lineNumber: 29,
                        columnNumber: 34
                    }, this))
            }, void 0, false, {
                fileName: "[project]/src/routes/VmFormPage.tsx",
                lineNumber: 28,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["FieldError"], {
                id: errorId,
                message: errors[name]
            }, void 0, false, {
                fileName: "[project]/src/routes/VmFormPage.tsx",
                lineNumber: 31,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/src/routes/VmFormPage.tsx",
        lineNumber: 26,
        columnNumber: 5
    }, this);
}
_c1 = SelectInput;
function VmFormPage({ mode }) {
    _s();
    const params = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$navigation$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useParams"])();
    const id = params.id;
    const router = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$navigation$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRouter"])();
    const queryClient = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$QueryClientProvider$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useQueryClient"])();
    const [values, setValues] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])({
        "VmFormPage.useState": ()=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$vmForm$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["emptyVmFormValues"])()
    }["VmFormPage.useState"]);
    const [errors, setErrors] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])({});
    const vmQuery = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$useQuery$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useQuery"])({
        queryKey: [
            'vm',
            id
        ],
        queryFn: {
            "VmFormPage.useQuery[vmQuery]": ()=>__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$api$2f$client$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["api"].getVm(id ?? '')
        }["VmFormPage.useQuery[vmQuery]"],
        enabled: mode === 'edit' && Boolean(id)
    });
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "VmFormPage.useEffect": ()=>{
            if (vmQuery.data) setValues((0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$vmForm$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["vmToFormValues"])(vmQuery.data));
        }
    }["VmFormPage.useEffect"], [
        vmQuery.data
    ]);
    const save = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$useMutation$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useMutation"])({
        mutationFn: {
            "VmFormPage.useMutation[save]": (payload)=>mode === 'create' ? __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$api$2f$client$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["api"].createVm(payload) : __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$api$2f$client$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["api"].updateVm(id ?? '', payload)
        }["VmFormPage.useMutation[save]"],
        onSuccess: {
            "VmFormPage.useMutation[save]": (vm)=>{
                queryClient.invalidateQueries({
                    queryKey: [
                        'vms'
                    ]
                });
                queryClient.setQueryData([
                    'vm',
                    vm.id
                ], vm);
                router.push(`/inventory/${vm.id}`);
            }
        }["VmFormPage.useMutation[save]"]
    });
    const title = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useMemo"])({
        "VmFormPage.useMemo[title]": ()=>mode === 'create' ? 'New VM' : `Edit ${vmQuery.data?.name ?? 'VM'}`
    }["VmFormPage.useMemo[title]"], [
        mode,
        vmQuery.data
    ]);
    function setField(name, value) {
        setValues((current)=>({
                ...current,
                [name]: value
            }));
        setErrors((current)=>({
                ...current,
                [name]: undefined
            }));
    }
    function submit(event) {
        event.preventDefault();
        const parsed = __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$vmForm$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["vmFormSchema"].safeParse(values);
        if (!parsed.success) {
            setErrors((0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$vmForm$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["collectErrors"])(parsed.error));
            return;
        }
        setErrors({});
        save.mutate(parsed.data);
    }
    if (vmQuery.isLoading) return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: "p-6",
        role: "status",
        children: "Loading VM…"
    }, void 0, false, {
        fileName: "[project]/src/routes/VmFormPage.tsx",
        lineNumber: 76,
        columnNumber: 33
    }, this);
    if (vmQuery.isError) return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Alert"], {
        children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$api$2f$client$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["detailMessage"])(vmQuery.error)
    }, void 0, false, {
        fileName: "[project]/src/routes/VmFormPage.tsx",
        lineNumber: 77,
        columnNumber: 31
    }, this);
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("section", {
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["PageHeader"], {
                title: title,
                actions: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"], {
                    className: __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["secondaryButtonClass"],
                    href: id ? `/inventory/${id}` : '/inventory',
                    children: "Cancel"
                }, void 0, false, {
                    fileName: "[project]/src/routes/VmFormPage.tsx",
                    lineNumber: 81,
                    columnNumber: 42
                }, this)
            }, void 0, false, {
                fileName: "[project]/src/routes/VmFormPage.tsx",
                lineNumber: 81,
                columnNumber: 7
            }, this),
            save.isError ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Alert"], {
                children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$api$2f$client$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["detailMessage"])(save.error)
            }, void 0, false, {
                fileName: "[project]/src/routes/VmFormPage.tsx",
                lineNumber: 82,
                columnNumber: 23
            }, this) : null,
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("form", {
                className: __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["cardClass"] + ' space-y-8',
                onSubmit: submit,
                noValidate: true,
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("fieldset", {
                        className: "space-y-4",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("legend", {
                                className: "text-lg font-semibold text-slate-950",
                                children: "Identity"
                            }, void 0, false, {
                                fileName: "[project]/src/routes/VmFormPage.tsx",
                                lineNumber: 85,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "grid gap-4 lg:grid-cols-4",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(TextInput, {
                                        name: "name",
                                        label: "Name",
                                        values: values,
                                        errors: errors,
                                        onChange: setField,
                                        required: true
                                    }, void 0, false, {
                                        fileName: "[project]/src/routes/VmFormPage.tsx",
                                        lineNumber: 87,
                                        columnNumber: 13
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(SelectInput, {
                                        name: "platform",
                                        label: "Platform",
                                        values: values,
                                        errors: errors,
                                        onChange: setField,
                                        options: __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$vmForm$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["platforms"],
                                        required: true
                                    }, void 0, false, {
                                        fileName: "[project]/src/routes/VmFormPage.tsx",
                                        lineNumber: 88,
                                        columnNumber: 13
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(TextInput, {
                                        name: "external_id",
                                        label: "External ID",
                                        values: values,
                                        errors: errors,
                                        onChange: setField
                                    }, void 0, false, {
                                        fileName: "[project]/src/routes/VmFormPage.tsx",
                                        lineNumber: 89,
                                        columnNumber: 13
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(SelectInput, {
                                        name: "status",
                                        label: "Status",
                                        values: values,
                                        errors: errors,
                                        onChange: setField,
                                        options: __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$vmForm$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["statuses"],
                                        required: true
                                    }, void 0, false, {
                                        fileName: "[project]/src/routes/VmFormPage.tsx",
                                        lineNumber: 90,
                                        columnNumber: 13
                                    }, this)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/src/routes/VmFormPage.tsx",
                                lineNumber: 86,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/src/routes/VmFormPage.tsx",
                        lineNumber: 84,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("fieldset", {
                        className: "space-y-4",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("legend", {
                                className: "text-lg font-semibold text-slate-950",
                                children: "Placement"
                            }, void 0, false, {
                                fileName: "[project]/src/routes/VmFormPage.tsx",
                                lineNumber: 94,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "grid gap-4 lg:grid-cols-4",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(TextInput, {
                                        name: "environment",
                                        label: "Environment",
                                        values: values,
                                        errors: errors,
                                        onChange: setField,
                                        required: true
                                    }, void 0, false, {
                                        fileName: "[project]/src/routes/VmFormPage.tsx",
                                        lineNumber: 96,
                                        columnNumber: 13
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(TextInput, {
                                        name: "datacenter",
                                        label: "Datacenter",
                                        values: values,
                                        errors: errors,
                                        onChange: setField
                                    }, void 0, false, {
                                        fileName: "[project]/src/routes/VmFormPage.tsx",
                                        lineNumber: 97,
                                        columnNumber: 13
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(TextInput, {
                                        name: "cluster",
                                        label: "Cluster",
                                        values: values,
                                        errors: errors,
                                        onChange: setField,
                                        required: true
                                    }, void 0, false, {
                                        fileName: "[project]/src/routes/VmFormPage.tsx",
                                        lineNumber: 98,
                                        columnNumber: 13
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(TextInput, {
                                        name: "host",
                                        label: "Host",
                                        values: values,
                                        errors: errors,
                                        onChange: setField,
                                        required: true
                                    }, void 0, false, {
                                        fileName: "[project]/src/routes/VmFormPage.tsx",
                                        lineNumber: 99,
                                        columnNumber: 13
                                    }, this)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/src/routes/VmFormPage.tsx",
                                lineNumber: 95,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/src/routes/VmFormPage.tsx",
                        lineNumber: 93,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("fieldset", {
                        className: "space-y-4",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("legend", {
                                className: "text-lg font-semibold text-slate-950",
                                children: "Capacity"
                            }, void 0, false, {
                                fileName: "[project]/src/routes/VmFormPage.tsx",
                                lineNumber: 103,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "grid gap-4 lg:grid-cols-4",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(TextInput, {
                                        name: "cpu_cores",
                                        label: "CPU cores",
                                        values: values,
                                        errors: errors,
                                        onChange: setField,
                                        type: "number",
                                        required: true
                                    }, void 0, false, {
                                        fileName: "[project]/src/routes/VmFormPage.tsx",
                                        lineNumber: 105,
                                        columnNumber: 13
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(TextInput, {
                                        name: "memory_mb",
                                        label: "Memory MB",
                                        values: values,
                                        errors: errors,
                                        onChange: setField,
                                        type: "number",
                                        required: true
                                    }, void 0, false, {
                                        fileName: "[project]/src/routes/VmFormPage.tsx",
                                        lineNumber: 106,
                                        columnNumber: 13
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(TextInput, {
                                        name: "disk_gb",
                                        label: "Disk GB",
                                        values: values,
                                        errors: errors,
                                        onChange: setField,
                                        type: "number",
                                        required: true
                                    }, void 0, false, {
                                        fileName: "[project]/src/routes/VmFormPage.tsx",
                                        lineNumber: 107,
                                        columnNumber: 13
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(TextInput, {
                                        name: "os_name",
                                        label: "Operating system",
                                        values: values,
                                        errors: errors,
                                        onChange: setField
                                    }, void 0, false, {
                                        fileName: "[project]/src/routes/VmFormPage.tsx",
                                        lineNumber: 108,
                                        columnNumber: 13
                                    }, this)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/src/routes/VmFormPage.tsx",
                                lineNumber: 104,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/src/routes/VmFormPage.tsx",
                        lineNumber: 102,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("fieldset", {
                        className: "space-y-4",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("legend", {
                                className: "text-lg font-semibold text-slate-950",
                                children: "Operations"
                            }, void 0, false, {
                                fileName: "[project]/src/routes/VmFormPage.tsx",
                                lineNumber: 112,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "grid gap-4 lg:grid-cols-4",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(TextInput, {
                                        name: "owner",
                                        label: "Owner",
                                        values: values,
                                        errors: errors,
                                        onChange: setField
                                    }, void 0, false, {
                                        fileName: "[project]/src/routes/VmFormPage.tsx",
                                        lineNumber: 114,
                                        columnNumber: 13
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(TextInput, {
                                        name: "backup_status",
                                        label: "Backup status",
                                        values: values,
                                        errors: errors,
                                        onChange: setField
                                    }, void 0, false, {
                                        fileName: "[project]/src/routes/VmFormPage.tsx",
                                        lineNumber: 115,
                                        columnNumber: 13
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                        className: "flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 lg:self-end",
                                        children: [
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("input", {
                                                className: "h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500",
                                                id: "ha_enabled",
                                                name: "ha_enabled",
                                                type: "checkbox",
                                                checked: values.ha_enabled,
                                                onChange: (event)=>setField('ha_enabled', event.target.checked)
                                            }, void 0, false, {
                                                fileName: "[project]/src/routes/VmFormPage.tsx",
                                                lineNumber: 117,
                                                columnNumber: 15
                                            }, this),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("label", {
                                                className: "text-sm font-medium text-slate-700",
                                                htmlFor: "ha_enabled",
                                                children: "HA enabled"
                                            }, void 0, false, {
                                                fileName: "[project]/src/routes/VmFormPage.tsx",
                                                lineNumber: 118,
                                                columnNumber: 15
                                            }, this)
                                        ]
                                    }, void 0, true, {
                                        fileName: "[project]/src/routes/VmFormPage.tsx",
                                        lineNumber: 116,
                                        columnNumber: 13
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(TextInput, {
                                        name: "dr_tier",
                                        label: "DR tier",
                                        values: values,
                                        errors: errors,
                                        onChange: setField
                                    }, void 0, false, {
                                        fileName: "[project]/src/routes/VmFormPage.tsx",
                                        lineNumber: 120,
                                        columnNumber: 13
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(SelectInput, {
                                        name: "criticality",
                                        label: "Criticality",
                                        values: values,
                                        errors: errors,
                                        onChange: setField,
                                        options: __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$vmForm$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["criticalities"],
                                        required: true
                                    }, void 0, false, {
                                        fileName: "[project]/src/routes/VmFormPage.tsx",
                                        lineNumber: 121,
                                        columnNumber: 13
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(SelectInput, {
                                        name: "lifecycle",
                                        label: "Lifecycle",
                                        values: values,
                                        errors: errors,
                                        onChange: setField,
                                        options: __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$vmForm$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["lifecycles"],
                                        required: true
                                    }, void 0, false, {
                                        fileName: "[project]/src/routes/VmFormPage.tsx",
                                        lineNumber: 122,
                                        columnNumber: 13
                                    }, this)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/src/routes/VmFormPage.tsx",
                                lineNumber: 113,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/src/routes/VmFormPage.tsx",
                        lineNumber: 111,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("fieldset", {
                        className: "space-y-4",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("legend", {
                                className: "text-lg font-semibold text-slate-950",
                                children: "Metadata"
                            }, void 0, false, {
                                fileName: "[project]/src/routes/VmFormPage.tsx",
                                lineNumber: 126,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "grid gap-4 lg:grid-cols-4",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(TextInput, {
                                        name: "ip_addresses",
                                        label: "IP addresses",
                                        values: values,
                                        errors: errors,
                                        onChange: setField
                                    }, void 0, false, {
                                        fileName: "[project]/src/routes/VmFormPage.tsx",
                                        lineNumber: 128,
                                        columnNumber: 13
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(TextInput, {
                                        name: "tags",
                                        label: "Tags",
                                        values: values,
                                        errors: errors,
                                        onChange: setField
                                    }, void 0, false, {
                                        fileName: "[project]/src/routes/VmFormPage.tsx",
                                        lineNumber: 129,
                                        columnNumber: 13
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(TextInput, {
                                        name: "last_verified_at",
                                        label: "Last verified date",
                                        values: values,
                                        errors: errors,
                                        onChange: setField,
                                        type: "date"
                                    }, void 0, false, {
                                        fileName: "[project]/src/routes/VmFormPage.tsx",
                                        lineNumber: 130,
                                        columnNumber: 13
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                        className: "lg:col-span-4",
                                        children: [
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("label", {
                                                className: "mb-1 block text-sm font-medium text-slate-700",
                                                htmlFor: "notes",
                                                children: "Notes"
                                            }, void 0, false, {
                                                fileName: "[project]/src/routes/VmFormPage.tsx",
                                                lineNumber: 132,
                                                columnNumber: 15
                                            }, this),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("textarea", {
                                                className: __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["textareaClass"],
                                                id: "notes",
                                                name: "notes",
                                                value: values.notes,
                                                onChange: (event)=>setField('notes', event.target.value),
                                                rows: 4
                                            }, void 0, false, {
                                                fileName: "[project]/src/routes/VmFormPage.tsx",
                                                lineNumber: 133,
                                                columnNumber: 15
                                            }, this)
                                        ]
                                    }, void 0, true, {
                                        fileName: "[project]/src/routes/VmFormPage.tsx",
                                        lineNumber: 131,
                                        columnNumber: 13
                                    }, this)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/src/routes/VmFormPage.tsx",
                                lineNumber: 127,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                                className: "text-sm text-slate-500",
                                children: "Separate IP addresses and tags with semicolons. Required fields are marked with an asterisk."
                            }, void 0, false, {
                                fileName: "[project]/src/routes/VmFormPage.tsx",
                                lineNumber: 136,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/src/routes/VmFormPage.tsx",
                        lineNumber: 125,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                            className: __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["primaryButtonClass"],
                            type: "submit",
                            disabled: save.isPending,
                            children: save.isPending ? 'Saving…' : 'Save VM'
                        }, void 0, false, {
                            fileName: "[project]/src/routes/VmFormPage.tsx",
                            lineNumber: 139,
                            columnNumber: 11
                        }, this)
                    }, void 0, false, {
                        fileName: "[project]/src/routes/VmFormPage.tsx",
                        lineNumber: 138,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/src/routes/VmFormPage.tsx",
                lineNumber: 83,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/src/routes/VmFormPage.tsx",
        lineNumber: 80,
        columnNumber: 5
    }, this);
}
_s(VmFormPage, "8z+G/fN/IWpyFrNpNQ+TCUoXjxc=", false, function() {
    return [
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$navigation$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useParams"],
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$navigation$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRouter"],
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$QueryClientProvider$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useQueryClient"],
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$useQuery$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useQuery"],
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$useMutation$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useMutation"]
    ];
});
_c2 = VmFormPage;
var _c, _c1, _c2;
__turbopack_context__.k.register(_c, "TextInput");
__turbopack_context__.k.register(_c1, "SelectInput");
__turbopack_context__.k.register(_c2, "VmFormPage");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
]);

//# sourceMappingURL=src_0mzatn3._.js.map