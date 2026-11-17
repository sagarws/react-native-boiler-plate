// @ts-nocheck

export function ProfileAvatar({ profile, className = "" }) {
  return (
    <span className={`avatar ${className}`.trim()}>
      {profile.photo ? (
        <img src={profile.photo} alt="" />
      ) : (
        profile.name.charAt(0).toUpperCase()
      )}
    </span>
  );
}
