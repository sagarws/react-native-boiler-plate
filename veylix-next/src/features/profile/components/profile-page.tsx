// @ts-nocheck
import { Fragment, useRef, useState } from "react";
import { CommercePageHeading } from "@/components/ui/commerce-page-heading";
import { ProfileAvatar } from "@/components/ui/profile-avatar";
import { modulesById } from "@/config/modules/registry";
import {
  profileFormFields,
  profilePhotoRules,
} from "@/features/profile/constants";
import { showToast } from "@/lib/events";
import { readProfile, saveProfile } from "@/lib/profile";

function readProfileForEditing() {
  return readProfile();
}

async function readProfilePhotoFile(e) {
  if (
    !profilePhotoRules.acceptedMimeTypes.includes(e.type) ||
    e.size > profilePhotoRules.maximumBytes
  )
    throw Error(profilePhotoRules.errorText);
  const t = await new Promise((t, n) => {
    const r = new FileReader();
    r.onload = () => t(String(r.result || ""));
    r.onerror = () => n(Error("The photo could not be read."));
    r.readAsDataURL(e);
  });
  await new Promise((e, n) => {
    const r = new Image();
    r.onload = () => e();
    r.onerror = () => n(Error("This file is not a readable image."));
    r.src = t;
  });
  return t;
}

export function ProfilePage() {
  const e = useRef(readProfileForEditing());
  const t = useRef(null);
  const [n, r] = useState(e.current.photo);
  const [i, a] = useState(e.current);
  const [o, s] = useState("");
  const c = modulesById.profile;
  async function u(e) {
    const t = e.target.files?.[0];
    if (t)
      try {
        const e = await readProfilePhotoFile(t);
        r(e);
        s("");
      } catch (t) {
        s(t instanceof Error ? t.message : profilePhotoRules.errorText);
        e.target.value = "";
      }
  }
  function d() {
    r("");
    if (t.current) {
      t.current.value = "";
    }
  }
  function f(e) {
    e.preventDefault();
    try {
      const t = saveProfile({
        ...Object.fromEntries(new FormData(e.currentTarget)),
        photo: n,
      });
      a(t);
      s("");
      showToast("Profile saved in this browser.");
    } catch (e) {
      s(e instanceof Error ? e.message : "Your profile could not be saved.");
    }
  }
  return (
    <Fragment>
      <CommercePageHeading title={c.title} />
      <form className="profile-layout" data-profile-form="" onSubmit={f}>
        <aside className="glass-card profile-summary">
          <ProfileAvatar
            profile={{
              name: e.current.name,
              photo: n,
            }}
            className="profile-portrait"
          />
          <h2 data-no-translate="">{i.name}</h2>
          <p>{i.role}</p>
          <label className="secondary-button profile-upload">
            Change photo
            <input
              ref={t}
              type="file"
              accept={profilePhotoRules.accept}
              name="photo"
              className="sr-only"
              onChange={u}
            />
          </label>
          <button
            type="button"
            className="text-link"
            data-remove-photo=""
            onClick={d}
          >
            Remove photo
          </button>
          <small>{profilePhotoRules.helpText}</small>
        </aside>
        <section className="glass-card">
          <div className="card-heading">
            <h2>Personal information</h2>
          </div>
          <div className="c-form-grid">
            {profileFormFields.map((t) => (
              <label key={t.key} className="c-field" htmlFor={`field-${t.key}`}>
                <span>
                  {t.label}
                  {t.required ? (
                    <Fragment>
                      {" "}
                      <small>*</small>
                    </Fragment>
                  ) : null}
                </span>
                <input
                  id={`field-${t.key}`}
                  name={t.key}
                  type={t.type}
                  required={t.required}
                  maxLength={t.maxLength}
                  defaultValue={e.current[t.key]}
                  placeholder=""
                />
              </label>
            ))}
          </div>
          <label className="c-field span-full" htmlFor="field-bio">
            <span>About you</span>
            <textarea
              id="field-bio"
              name="bio"
              rows={4}
              maxLength={2e4}
              placeholder=""
              defaultValue={e.current.bio}
            />
          </label>
          <p className="c-form-error" role="alert">
            {o}
          </p>
          <div className="c-form-footer">
            <button type="submit" className="primary-button" data-c-action="">
              Save changes
            </button>
          </div>
        </section>
      </form>
    </Fragment>
  );
}
