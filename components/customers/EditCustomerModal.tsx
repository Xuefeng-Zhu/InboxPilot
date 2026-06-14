'use client';

import { useState } from 'react';
import { Button, Input } from '@/components/ui';
import { insforge } from '@/lib/insforge';

interface EditCustomerModalProps {
  customerId: string;
  initialName: string;
  initialEmail: string;
  initialPhone: string;
  onClose: () => void;
  onSaved: () => void;
}

export function EditCustomerModal({
  customerId,
  initialName,
  initialEmail,
  initialPhone,
  onClose,
  onSaved,
}: EditCustomerModalProps) {
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [phone, setPhone] = useState(initialPhone);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const { error: updateError } = await insforge.database
        .from('contacts')
        .update({
          name: name.trim() || null,
          email: email.trim() || null,
          phone: phone.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', customerId);

      if (updateError) {
        setError(updateError.message);
        return;
      }

      onSaved();
    } catch {
      setError('Failed to update customer');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border border-[var(--m03-line)] bg-white p-6 shadow-[0_30px_80px_rgba(0,0,0,0.08)]">
        <h2 className="m-0 mb-4 text-[16px] font-semibold text-[var(--m03-fg)]">Edit customer</h2>

        {error && (
          <p className="mb-3 text-[12px] text-[var(--m03-red)]">{error}</p>
        )}

        <div className="space-y-3">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer name" />
          <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" />
          <Input label="Phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 000 0000" />
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="md" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" size="md" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}
