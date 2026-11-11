import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/Bits";
import { CustomerTabs } from "@/pages/customer/MyBookings";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function Profile() {
  const { user, setUser } = useAuth();
  const [f, setF] = useState({ name: user.name, age: user.age || "", mobile: user.mobile || "" });
  const [pw, setPw] = useState({ current_password: "", new_password: "" });
  const save = async (e) => {
    e.preventDefault();
    try {
      const { data } = await api.patch("/auth/me", { name: f.name, age: f.age ? Number(f.age) : null, mobile: f.mobile || null });
      setUser(data);
      toast.success("Profile saved");
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  const changePw = async (e) => {
    e.preventDefault();
    try {
      await api.post("/auth/change-password", pw);
      setPw({ current_password: "", new_password: "" });
      toast.success("Password changed");
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
      <CustomerTabs />
      <h1 className="headline text-5xl mb-6">Profile</h1>
      <div className="grid md:grid-cols-2 gap-6">
        <form onSubmit={save} className="surface p-6 space-y-4" data-testid="profile-form">
          <Field label="Email"><input className="field opacity-60" value={user.email} disabled /></Field>
          <Field label="Full name"><input className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="profile-name-input" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Age"><input className="field" type="number" value={f.age} onChange={(e) => setF({ ...f, age: e.target.value })} data-testid="profile-age-input" /></Field>
            <Field label="Mobile"><input className="field" value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} data-testid="profile-mobile-input" /></Field>
          </div>
          <Button data-testid="profile-save-btn">Save profile</Button>
        </form>
        <form onSubmit={changePw} className="surface p-6 space-y-4" data-testid="password-form">
          <Field label="Current password"><input className="field" type="password" required value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} data-testid="pw-current-input" /></Field>
          <Field label="New password"><input className="field" type="password" minLength={8} required value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} data-testid="pw-new-input" /></Field>
          <Button variant="outline" data-testid="pw-save-btn">Change password</Button>
        </form>
      </div>
    </div>
  );
}
