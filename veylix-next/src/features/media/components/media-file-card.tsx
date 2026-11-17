// @ts-nocheck
import { Icon } from "@/components/icons/icon";

export function MediaFileCard({
  file,
  previewUrl,
  onPreview,
  onStar,
  onEdit,
  onTrash,
}) {
  const o = file.type.startsWith("image/");
  const s = file.type.startsWith("audio/");
  return (
    <article className="c-media-file">
      <button
        type="button"
        className="c-media-thumb"
        data-c-action="media-preview"
        data-id={file.id}
        aria-label={`Preview ${file.name}`}
        onClick={() => onPreview(file)}
      >
        {o && previewUrl ? (
          <img src={previewUrl} alt={file.name} />
        ) : (
          <Icon name={s ? "chats-circle" : "notebook"} />
        )}
      </button>
      <div>
        <strong>{file.name}</strong>
        <small>
          {file.folder}
          {" · "}
          {(file.size / 1024).toFixed(1)}
          {" KB"}
        </small>
      </div>
      <div className="c-media-actions">
        <button
          type="button"
          className="secondary-button"
          data-c-action="media-star"
          data-id={file.id}
          onClick={() => onStar(file)}
        >
          {file.starred ? "Unstar" : "Star"}
        </button>
        <button
          type="button"
          className="secondary-button"
          data-c-action="media-edit"
          data-id={file.id}
          onClick={() => onEdit(file)}
        >
          Edit
        </button>
        <button
          type="button"
          className="secondary-button"
          data-c-action="media-trash"
          data-id={file.id}
          onClick={() => onTrash(file)}
        >
          {file.trashed ? "Restore" : "Trash"}
        </button>
      </div>
    </article>
  );
}
