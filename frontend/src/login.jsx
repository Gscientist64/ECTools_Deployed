import React, { useState } from 'react';
import { useAuth } from './auth';
import { useToast } from './toasts';
import { LogIn, UserPlus, Eye, EyeOff, Building2, Shield } from 'lucide-react';

const LOGO_URL = `${import.meta.env.BASE_URL}ecews-logo.png`;

const FACILITIES = [
  "Akamkpa General Hospital",
  "Akani Esuk Health Centre",
  "Akpabuyo St Joseph Hospital",
  "Akpet Central",
  "Anantigha Primary Health Centre",
  "Anderson Primary Health Centre",
  "Aningeje Primary Health Centre",
  "Aya Medical Center",
  "Bakor Medical centre",
  "Calabar General Hospital",
  "Calabar South Family Health Centre",
  "Calabar Women and Children Hospital",
  "County Specialist",
  "Cross River University of Science and Technology (CRUTECH) Medical Centre",
  "Diamond Hill Health Centre",
  "Dr Lawrence Henshaw Memorial Hospital",
  "Eja Memorial",
  "Ekana Medical Center",
  "Ekorinim Health Centre",
  "Ekpo Abasi Primary Health Centre",
  "Ekpri Obutong Health Centre",
  "Emmanuel Infirmiry",
  "Essierebom Primary Health Centre",
  "Faith Foundation Clinic",
  "Goldie Clinic",
  "Henshaw Town Health Post",
  "Hiltop Healthcare Foundation",
  "Holy Family Catholic Hospital",
  "Igbo-Imabana Model PHC",
  "Ikang Primary Health Centre",
  "Ikot Edem Odo Health Centre",
  "Ikot Effiong Otop Comprehensive Health Centre (UCTH Annex)",
  "Ikot Ekpo Health Centre (Ward 10)",
  "Ikot Enebong Health Post",
  "Ishie Health Post",
  "Kasuk Health Centre",
  "Katchuan Iruan Model PHC",
  "Mambo Clinic",
  "Melrose Hospital",
  "Mfamosing Primary Health Center",
  "Mma Efa Health Centre",
  "Mount Zion Medical Centre",
  "Nyahasang Health Centre",
  "Oba Comprehensive Health Centre",
  "Oban Health Centre",
  "Obanliku General Hospital",
  "Obubra General Hospital",
  "Obubra Maternal & Child Health Clinic",
  "Obudu CLinic",
  "Obudu Urban1 PHC",
  "Ogoja Catholic Maternity",
  "Ogoja General Hospital",
  "Ogoja Santa Maria Clinic",
  "Okpoma General Hospital",
  "Okundi Comprehensive Health Centre",
  "Peace medical centre",
  "Police Hospital",
  "Sacred Heart Catholic Hospital",
  "Ugep General Hospital",
  "Ukpem General Hospital",
  "University of Calabar Medical Centre",
  "University of Calabar Teaching Hospital",
  "Wanihem Comprehensive Health Centre",
  "Yala Lutheran Hospital",
  "State Office Team",
].map((f) => ({ value: f, label: f }));

function passwordStrength(pw) {
  if (!pw) return { score: 0, label: '', color: '' };
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw)) s++;
  if (/[A-Z]/.test(pw)) s++;
  if (/[0-9]/.test(pw)) s++;
  if (/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(pw)) s++;
  if (s <= 2) return { score: s, label: 'Weak', color: 'bg-red-500' };
  if (s <= 4) return { score: s, label: 'Fair', color: 'bg-amber-400' };
  return { score: s, label: 'Strong', color: 'bg-emerald-500' };
}

function Field({ label, hint, error, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-neutral-600 uppercase tracking-wide">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-neutral-400">{hint}</p>}
      {error && <p className="text-[11px] text-red-500">{error}</p>}
    </div>
  );
}

function TextInput({ icon: Icon, right, className = '', ...props }) {
  return (
    <div className="relative">
      {Icon && (
        <Icon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400 pointer-events-none" />
      )}
      <input
        {...props}
        className={`w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none transition
          focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 focus:bg-white
          disabled:opacity-50
          ${Icon ? 'pl-9' : ''}
          ${right ? 'pr-10' : ''}
          ${className}`}
      />
      {right && <div className="absolute right-3 top-1/2 -translate-y-1/2">{right}</div>}
    </div>
  );
}

function FacilitySelect({ value, onChange }) {
  return (
    <div className="relative">
      <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400 pointer-events-none z-10" />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-xl border border-neutral-200 bg-neutral-50 pl-9 pr-9 py-2.5 text-sm text-neutral-900 outline-none transition
          focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 focus:bg-white"
      >
        <option value="">Select your facility…</option>
        {FACILITIES.map((f) => (
          <option key={f.value} value={f.value}>{f.label}</option>
        ))}
      </select>
      <svg className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </div>
  );
}

function SubmitButton({ loading, children }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-semibold py-2.5 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}

/* ─── Decorative background dots for the left panel ─── */
function Dots() {
  return (
    <svg className="absolute inset-0 w-full h-full opacity-[0.07]" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="dots" x="0" y="0" width="28" height="28" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="2" fill="white" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#dots)" />
    </svg>
  );
}

export default function Login() {
  const { login, signup } = useAuth();
  const { push } = useToast();
  const [tab, setTab] = useState('login');
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [form, setForm] = useState({
    username: '', password: '', confirm_password: '',
    first_name: '', email: '', facility: '', role: 'user', admin_key: '',
  });

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const pw = passwordStrength(form.password);

  async function onLogin(e) {
    e.preventDefault();
    if (!form.username || !form.password) { push('Enter username and password', 'error'); return; }
    setLoading(true);
    try {
      await login(form.username, form.password);
      push('Logged in', 'success');
    } catch {
      push('Invalid credentials', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function onSignup(e) {
    e.preventDefault();
    if (!form.first_name || !form.username || !form.password || !form.facility) {
      push('All required fields must be filled', 'error'); return;
    }
    if (form.password !== form.confirm_password) { push('Passwords do not match', 'error'); return; }
    if (form.password.length < 8) { push('Password must be at least 8 characters', 'error'); return; }
    if (form.role === 'admin' && !form.admin_key) { push('Admin key is required', 'error'); return; }
    setLoading(true);
    try {
      await signup({
        first_name: form.first_name, email: form.email,
        username: form.username, password: form.password,
        facility: form.facility, role: form.role,
        admin_key: form.role === 'admin' ? form.admin_key : undefined,
      });
      push('Account created — please sign in', 'success');
      setTab('login');
    } catch (err) {
      push((err && err.message) || 'Signup failed', 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex">

      {/* ── Left branding panel (desktop only) ── */}
      <div className="hidden lg:flex lg:w-[42%] xl:w-[38%] relative flex-col items-center justify-center p-14 overflow-hidden
                      bg-gradient-to-br from-emerald-700 via-emerald-600 to-green-700">
        <Dots />

        {/* Floating accent rings */}
        <div className="absolute -top-24 -left-24 h-96 w-96 rounded-full border border-white/10" />
        <div className="absolute -bottom-32 -right-32 h-80 w-80 rounded-full border border-white/10" />
        <div className="absolute top-1/3 right-0 h-48 w-48 rounded-full border border-white/10" />

        <div className="relative z-10 flex flex-col items-center text-center">
          {/* Logo */}
          <div className="h-40 w-40 rounded-3xl bg-white flex items-center justify-center shadow-2xl ring-4 ring-white/20 p-3">
            <img src={LOGO_URL} alt="ECEWS" className="h-full w-full object-contain" />
          </div>

          <h1 className="mt-8 text-3xl font-bold text-white tracking-tight">ECEWS ACE5</h1>
          <p className="text-emerald-200 font-semibold text-lg mt-0.5">Tools Inventory</p>
          <p className="mt-4 text-sm text-emerald-100/80 max-w-[260px] leading-relaxed">
            Tools Inventory Management across ACE-5, CRS
          </p>

          {/* Stats strip */}
          <div className="mt-10 flex gap-4">
            <div className="flex-1 rounded-2xl bg-white/10 backdrop-blur-sm ring-1 ring-white/10 px-6 py-4 text-center">
              <div className="text-2xl font-bold text-white">64</div>
              <div className="text-[11px] text-emerald-200 mt-0.5 uppercase tracking-wide">Facilities</div>
            </div>
            <div className="flex-1 rounded-2xl bg-white/10 backdrop-blur-sm ring-1 ring-white/10 px-6 py-4 text-center">
              <div className="text-2xl font-bold text-white">CRS</div>
              <div className="text-[11px] text-emerald-200 mt-0.5 uppercase tracking-wide">State</div>
            </div>
          </div>
        </div>

        {/* Bottom attribution */}
        <p className="absolute bottom-6 text-[11px] text-emerald-300/60 tracking-widest uppercase">
          ECEWS • ACE5 Project
        </p>
      </div>

      {/* ── Right form panel ── */}
      <div className="flex-1 flex flex-col items-center justify-center min-h-screen bg-white px-6 py-12 lg:px-14">

        {/* Mobile header */}
        <div className="lg:hidden flex flex-col items-center mb-8">
          <div className="h-20 w-20 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center shadow-sm p-2">
            <img src={LOGO_URL} alt="ECEWS" className="h-full w-full object-contain" />
          </div>
          <h1 className="mt-3 text-base font-bold text-neutral-800">ECEWS ACE5 TOOLS INVENTORY</h1>
        </div>

        <div className="w-full max-w-[420px]">

          {/* Tab switcher */}
          <div className="flex border-b border-neutral-200 mb-8">
            {[['login', 'Sign in'], ['signup', 'Create account']].map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`mr-8 pb-3 text-sm font-semibold border-b-2 transition-all -mb-px ${
                  tab === id
                    ? 'border-emerald-600 text-emerald-700'
                    : 'border-transparent text-neutral-400 hover:text-neutral-600 hover:border-neutral-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* ── LOGIN FORM ── */}
          {tab === 'login' && (
            <form onSubmit={onLogin} className="flex flex-col gap-5">
              <div>
                <h2 className="text-2xl font-bold text-neutral-900">Welcome back</h2>
                <p className="text-sm text-neutral-500 mt-1">Sign in to your account to continue</p>
              </div>

              <Field label="Username or Email">
                <TextInput
                  value={form.username}
                  onChange={(e) => set('username', e.target.value)}
                  placeholder="Enter your username or email"
                  autoComplete="username"
                  autoFocus
                />
              </Field>

              <Field label="Password">
                <TextInput
                  type={showPw ? 'text' : 'password'}
                  value={form.password}
                  onChange={(e) => set('password', e.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  right={
                    <button type="button" onClick={() => setShowPw(!showPw)} className="text-neutral-400 hover:text-neutral-600 transition-colors">
                      {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  }
                />
              </Field>

              <SubmitButton loading={loading}>
                <LogIn className="h-4 w-4" />
                {loading ? 'Signing in…' : 'Sign in'}
              </SubmitButton>

              <p className="text-center text-xs text-neutral-400">
                Don't have an account?{' '}
                <button type="button" onClick={() => setTab('signup')} className="text-emerald-600 font-semibold hover:underline">
                  Create one
                </button>
              </p>
            </form>
          )}

          {/* ── SIGNUP FORM ── */}
          {tab === 'signup' && (
            <form onSubmit={onSignup} className="flex flex-col gap-4">
              <div>
                <h2 className="text-2xl font-bold text-neutral-900">Create an account</h2>
                <p className="text-sm text-neutral-500 mt-1">Register your facility account below</p>
              </div>

              {/* Row 1: Name + Email */}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Full name *">
                  <TextInput
                    value={form.first_name}
                    onChange={(e) => set('first_name', e.target.value)}
                    placeholder="e.g. Amaka"
                    autoComplete="given-name"
                  />
                </Field>
                <Field label="Email">
                  <TextInput
                    type="email"
                    value={form.email}
                    onChange={(e) => set('email', e.target.value)}
                    placeholder="you@org.com"
                    autoComplete="email"
                  />
                </Field>
              </div>

              {/* Username */}
              <Field label="Username *">
                <TextInput
                  value={form.username}
                  onChange={(e) => set('username', e.target.value)}
                  placeholder="Choose a username"
                  autoComplete="username"
                />
              </Field>

              {/* Facility */}
              <Field label="Facility *">
                <FacilitySelect value={form.facility} onChange={(v) => set('facility', v)} />
              </Field>

              {/* Role */}
              <Field label="Role *">
                <div className="flex gap-2">
                  {[['user', 'Facility User'], ['admin', 'Admin (HQ)']].map(([val, lbl]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => set('role', val)}
                      className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-xs font-semibold transition-all ${
                        form.role === val
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                          : 'border-neutral-200 bg-neutral-50 text-neutral-500 hover:border-neutral-300 hover:bg-white'
                      }`}
                    >
                      {val === 'admin' && <Shield className="h-3.5 w-3.5" />}
                      {lbl}
                    </button>
                  ))}
                </div>
              </Field>

              {/* Admin key (conditional) */}
              {form.role === 'admin' && (
                <Field
                  label="Admin Key *"
                  hint="Contact the State HiFRAVL team if you don't have an admin key."
                >
                  <TextInput
                    type="password"
                    value={form.admin_key}
                    onChange={(e) => set('admin_key', e.target.value)}
                    placeholder="Enter admin key"
                    icon={Shield}
                  />
                </Field>
              )}

              {/* Row: Password + Confirm */}
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Password *"
                  error={form.password && form.password.length < 8 ? 'Min 8 characters' : ''}
                >
                  <TextInput
                    type={showPw ? 'text' : 'password'}
                    value={form.password}
                    onChange={(e) => set('password', e.target.value)}
                    placeholder="Create password"
                    autoComplete="new-password"
                    right={
                      <button type="button" onClick={() => setShowPw(!showPw)} className="text-neutral-400 hover:text-neutral-600 transition-colors">
                        {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    }
                  />
                </Field>
                <Field
                  label="Confirm *"
                  error={
                    form.confirm_password && form.password !== form.confirm_password
                      ? 'No match'
                      : ''
                  }
                >
                  <TextInput
                    type={showConfirm ? 'text' : 'password'}
                    value={form.confirm_password}
                    onChange={(e) => set('confirm_password', e.target.value)}
                    placeholder="Repeat password"
                    autoComplete="new-password"
                    right={
                      <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="text-neutral-400 hover:text-neutral-600 transition-colors">
                        {showConfirm ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    }
                  />
                </Field>
              </div>

              {/* Password strength bar */}
              {form.password && (
                <div className="flex items-center gap-2 -mt-1">
                  <div className="flex flex-1 gap-1">
                    {[1, 2, 3, 4, 5, 6].map((i) => (
                      <div
                        key={i}
                        className={`h-1 flex-1 rounded-full transition-all ${
                          i <= pw.score ? pw.color : 'bg-neutral-200'
                        }`}
                      />
                    ))}
                  </div>
                  <span className="text-[11px] font-medium text-neutral-500 w-10">{pw.label}</span>
                </div>
              )}

              <SubmitButton loading={loading}>
                <UserPlus className="h-4 w-4" />
                {loading ? 'Creating account…' : 'Create account'}
              </SubmitButton>

              <p className="text-center text-xs text-neutral-400">
                Already have an account?{' '}
                <button type="button" onClick={() => setTab('login')} className="text-emerald-600 font-semibold hover:underline">
                  Sign in
                </button>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
