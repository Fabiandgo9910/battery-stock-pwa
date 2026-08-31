'use client';

import { useEffect, useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import Pagination from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';
import toast from 'react-hot-toast';
import type { Profile, UserRole } from '@/types/domain';

const ROLE_LABEL: Record<UserRole, string> = {
  admin: 'Administrador',
  almacenero: 'Almacenero',
  conductor: 'Conductor / Vendedor',
  comercial: 'Comercial',
};

export default function UsuariosPage() {
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState<Profile | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toDelete, setToDelete] = useState<Profile | null>(null);
  const [search, setSearch] = useState('');

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('conductor');
  const [phone, setPhone] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [zone, setZone] = useState('');
  const [driverCode, setDriverCode] = useState('');

  async function load() {
    setLoading(true);
    const res = await fetch('/api/users');
    const json = await res.json();
    setUsers(json.users ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function resetForm() {
    setFullName('');
    setEmail('');
    setPassword('');
    setRole('conductor');
    setPhone('');
    setVehiclePlate('');
    setZone('');
    setDriverCode('');
    setShowForm(false);
    setEditingUser(null);
  }

  function startEdit(u: Profile) {
    setEditingUser(u);
    setFullName(u.full_name);
    setEmail(u.email);
    setRole(u.role);
    setPhone(u.phone ?? '');
    setVehiclePlate(u.vehicle_plate ?? '');
    setZone(u.zone ?? '');
    setDriverCode(u.driver_code ?? '');
    setShowForm(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);

    if (editingUser) {
      const res = await fetch(`/api/users/${editingUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: fullName,
          role,
          phone: phone || undefined,
          vehicle_plate: role === 'conductor' ? vehiclePlate || undefined : undefined,
          zone: role === 'conductor' ? zone || undefined : undefined,
          driver_code: role === 'conductor' ? driverCode || undefined : undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      setSubmitting(false);
      if (!res.ok) {
        toast.error(json.error || 'Error al editar usuario');
        return;
      }
      toast.success('Usuario actualizado correctamente.');
      resetForm();
      load();
      return;
    }

    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: fullName,
        email,
        password,
        role,
        phone: phone || undefined,
        vehicle_plate: vehiclePlate || undefined,
        zone: zone || undefined,
        driver_code: driverCode || undefined,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setSubmitting(false);
    if (!res.ok) {
      toast.error(json.error || 'Error al crear usuario');
      return;
    }
    toast.success('Usuario creado correctamente.');
    resetForm();
    load();
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setSubmitting(true);
    const res = await fetch(`/api/users/${toDelete.id}`, { method: 'DELETE' });
    const json = await res.json().catch(() => ({}));
    setSubmitting(false);
    setToDelete(null);
    if (!res.ok) {
      toast.error(json.error || 'Error al eliminar el usuario.', json.reason === 'stock' ? { duration: 7000 } : undefined);
      return;
    }
    toast.success('Usuario eliminado permanentemente.');
    load();
  }

  const filteredUsers = users.filter((u) =>
    `${u.full_name} ${u.email} ${ROLE_LABEL[u.role]}`.toLowerCase().includes(search.toLowerCase())
  );
  const { page, setPage, pageItems, total } = usePagination(filteredUsers, 10);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Usuarios</h1>
          <p className="mt-1 text-sm text-slate-500">Gestiona conductores, almaceneros, comerciales y administradores.</p>
        </div>
        <button className="btn-charge" onClick={() => (showForm ? resetForm() : setShowForm(true))}>
          {showForm ? 'Cerrar' : '+ Nuevo usuario'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={submit} className="card mt-6 space-y-4">
          {editingUser && (
            <p className="rounded-xl bg-charge-50 px-4 py-2 text-sm text-charge-700">
              Editando a <strong>{editingUser.full_name}</strong>. El correo no se puede cambiar aquí.
            </p>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label-field">Nombre completo *</label>
              <input required className="input-field" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div>
              <label className="label-field">Rol *</label>
              <select className="input-field" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
                {Object.entries(ROLE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label-field">Correo electrónico *</label>
              <input
                required
                type="email"
                disabled={!!editingUser}
                className="input-field disabled:bg-slate-100 disabled:text-slate-400"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            {!editingUser && (
              <div>
                <label className="label-field">Contraseña provisional *</label>
                <input required type="password" minLength={6} className="input-field" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            )}
            <div>
              <label className="label-field">Teléfono</label>
              <input className="input-field" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            {role === 'conductor' && (
              <>
                <div>
                  <label className="label-field">Matrícula del vehículo</label>
                  <input className="input-field" value={vehiclePlate} onChange={(e) => setVehiclePlate(e.target.value)} />
                </div>
                <div>
                  <label className="label-field">Zona</label>
                  <input className="input-field" value={zone} onChange={(e) => setZone(e.target.value)} />
                </div>
                <div>
                  <label className="label-field">Código de conductor *</label>
                  <input
                    className="input-field uppercase"
                    value={driverCode}
                    onChange={(e) => setDriverCode(e.target.value.toUpperCase())}
                    placeholder="Ej: SB"
                    maxLength={6}
                  />
                  <p className="mt-1 text-xs text-slate-400">
                    Se usa para generar el code de cada batería que se le entregue (p.ej. &quot;TK720 {driverCode || 'SB'}220801&quot;).
                  </p>
                </div>
              </>
            )}
          </div>
          <button type="submit" disabled={submitting} className="btn-charge w-full">
            {submitting ? 'Guardando…' : editingUser ? 'Guardar cambios' : 'Crear usuario'}
          </button>
        </form>
      )}

      <input
        className="input-field mt-6"
        placeholder="Buscar por nombre, correo o rol…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="mt-4 space-y-3">
        {loading && <p className="text-sm text-slate-400">Cargando…</p>}
        {pageItems.map((u) => (
          <div key={u.id} className="card flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-slate-900">{u.full_name}</p>
              <p className="text-sm text-slate-500">{u.email} · {ROLE_LABEL[u.role]}</p>
              {u.vehicle_plate && <p className="text-xs text-slate-400">Vehículo: {u.vehicle_plate} {u.zone ? `· Zona: ${u.zone}` : ''}</p>}
              {u.role === 'conductor' && (
                <p className="text-xs text-slate-400">
                  Código: {u.driver_code ? <strong>{u.driver_code}</strong> : <span className="text-amber-600">sin asignar</span>}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn-secondary" onClick={() => startEdit(u)}>Editar</button>
              <button className="btn-secondary text-red-600" onClick={() => setToDelete(u)}>Eliminar</button>
            </div>
          </div>
        ))}
        {!loading && filteredUsers.length === 0 && (
          <div className="card text-center text-slate-400">Ningún usuario coincide con la búsqueda.</div>
        )}
      </div>

      <Pagination page={page} pageSize={10} total={total} onPageChange={setPage} />

      <ConfirmModal
        open={!!toDelete}
        title="Eliminar usuario permanentemente"
        description={`Esta acción borra a ${toDelete?.full_name} del sistema por completo (no queda ningún rastro). Solo se bloqueará si todavía tiene stock de baterías asignado — en ese caso te lo avisará y tendrás que retirárselo primero.`}
        confirmLabel="Eliminar"
        tone="danger"
        loading={submitting}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
