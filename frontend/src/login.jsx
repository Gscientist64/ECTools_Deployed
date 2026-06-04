import React, { useState } from 'react';
import { useAuth } from './auth';
import { useToast } from './toasts';
import { Input, Button, Select } from './ui';
import { LogIn, UserPlus } from 'lucide-react';

// ✅ Use BASE_URL so the logo loads from /toolsapp/ecews-logo.png in production
const LOGO_URL = `${import.meta.env.BASE_URL}ecews-logo.png`;

// Full facilities list
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
  "State Office Team"
].map(f => ({ value: f, label: f }));

const ROLES = [
  { value: 'user', label: 'User' },
  { value: 'admin', label: 'Admin' },
];

export default function Login() {
  const { login, signup } = useAuth();
  const { push } = useToast();
  const [tab, setTab] = useState('login');
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    username: '',
    password: '',
    first_name: '',
    email: '',
    facility: '',
    role: 'user',
    admin_key: '', // NEW
  });

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function onLogin(e) {
    e.preventDefault();
    setLoading(true);
    try {
      if (!form.username || !form.password) {
        push('Please enter username and password', 'error');
        return;
      }
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
    setLoading(true);
    try {
      if (!form.first_name || !form.username || !form.password || !form.facility || !form.role) {
        push('All fields are required', 'error');
        return;
      }
      // If role is admin, require admin_key
      if (form.role === 'admin' && !form.admin_key) {
        push('Admin key is required for admin signup', 'error');
        return;
      }

      await signup({
        first_name: form.first_name,
        email: form.email,
        username: form.username,
        password: form.password,
        facility: form.facility,
        role: form.role,
        admin_key: form.role === 'admin' ? form.admin_key : undefined, // NEW
      });
      push('Account created. Please log in.', 'success');
      setTab('login');
    } catch (err) {
      push((err && err.message) || 'Signup failed', 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Green gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-600 via-green-600 to-emerald-700" />
      <div className="absolute inset-0 bg-white/20 backdrop-blur-sm" />

      {/* Centered card */}
      <div className="relative min-h-screen grid place-items-center p-4">
        <div className="w-[92vw] max-w-md rounded-3xl shadow-2xl border border-white/30 bg-white/85 backdrop-blur-xl">
          {/* Header */}
          <div className="p-6 text-center">
            <div className="mx-auto h-20 w-20 rounded-full bg-white shadow flex items-center justify-center overflow-hidden">
              {/* ✅ Use BASE_URL-aware logo path */}
              <img src={LOGO_URL} alt="ECEWS" className="h-16 w-16 object-contain" />
            </div>
            <h1 className="mt-3 text-xl font-bold text-neutral-900">ECEWS ACE5 TOOLS INVENTORY</h1>
            <p className="text-sm text-neutral-700">Cross River</p>
          </div>

          {/* Tabs */}
          <div className="px-4">
            <div className="grid grid-cols-2 p-1 rounded-2xl bg-white/80 border border-neutral-200">
              <button
                onClick={() => setTab('login')}
                className={`px-3 py-2 rounded-xl text-sm font-semibold transition ${
                  tab === 'login'
                    ? 'bg-gradient-to-r from-emerald-600 to-green-600 text-white shadow'
                    : 'text-neutral-700 hover:bg-neutral-100'
                }`}
              >
                Login
              </button>
              <button
                onClick={() => setTab('signup')}
                className={`px-3 py-2 rounded-xl text-sm font-semibold transition ${
                  tab === 'signup'
                    ? 'bg-gradient-to-r from-emerald-600 to-green-600 text-white shadow'
                    : 'text-neutral-700 hover:bg-neutral-100'
                }`}
              >
                Sign up
              </button>
            </div>
          </div>

          {/* Forms */}
          <div className="p-6">
            {tab === 'login' ? (
              <form onSubmit={onLogin} className="grid gap-4">
                <div>
                  <label className="block text-xs font-semibold text-neutral-800 mb-1">Username</label>
                  <Input value={form.username} onChange={(e) => set('username', e.target.value)} placeholder="e.g., ejike" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-800 mb-1">Password</label>
                  <Input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} placeholder="••••••••" />
                </div>
                <Button type="submit" disabled={loading} className="w-full">
                  <LogIn className="h-4 w-4" />
                  {loading ? 'Signing in…' : 'Login'}
                </Button>
              </form>
            ) : (
              <form onSubmit={onSignup} className="grid gap-4">
                <div>
                  <label className="block text-xs font-semibold text-neutral-800 mb-1">Full name *</label>
                  <Input value={form.first_name} onChange={(e) => set('first_name', e.target.value)} placeholder="e.g., Amaka" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-800 mb-1">Email</label>
                  <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="e.g., amaka@org.org" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-800 mb-1">Facility *</label>
                  <Select value={form.facility} onChange={(v) => set('facility', v)} options={FACILITIES} placeholder="Select facility" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-800 mb-1">Role *</label>
                  <Select value={form.role} onChange={(v) => set('role', v)} options={ROLES} placeholder="Select role" />
                </div>

                {/* Admin key appears only when role === 'admin' */}
                {form.role === 'admin' && (
                  <div>
                    <label className="block text-xs font-semibold text-neutral-800 mb-1">Admin Key *</label>
                    <Input
                      type="password"
                      value={form.admin_key}
                      onChange={(e) => set('admin_key', e.target.value)}
                      placeholder="Enter admin key"
                    />
                    <p className="mt-1 text-[11px] text-neutral-600">
                      Contact the State HiFRAVL team if you don’t have an admin key.
                    </p>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-neutral-800 mb-1">Username *</label>
                  <Input value={form.username} onChange={(e) => set('username', e.target.value)} placeholder="Choose a username" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-800 mb-1">Password *</label>
                  <Input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} placeholder="Create a password" />
                </div>
                <Button type="submit" disabled={loading} className="w-full">
                  <UserPlus className="h-4 w-4" />
                  {loading ? 'Creating…' : 'Create account'}
                </Button>
              </form>
            )}
          </div>

          <div className="px-6 pb-6 text-center text-xs text-neutral-700">
            ECEWS • ACE5 PROJECT
          </div>
        </div>
      </div>
    </div>
  );
}
