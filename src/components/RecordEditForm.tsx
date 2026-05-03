import type { FormEvent } from "react";

type RecordEditFormProps = {
  editingRecordName: string;
  editingRecordType: string;
  editingRecordContent: string;
  editingRecordTtl: string;
  savingEditedRecord: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onCancel: () => void;
  setEditingRecordName: (value: string) => void;
  setEditingRecordType: (value: string) => void;
  setEditingRecordContent: (value: string) => void;
  setEditingRecordTtl: (value: string) => void;
};

export function RecordEditForm({
  editingRecordName,
  editingRecordType,
  editingRecordContent,
  editingRecordTtl,
  savingEditedRecord,
  onSubmit,
  onCancel,
  setEditingRecordName,
  setEditingRecordType,
  setEditingRecordContent,
  setEditingRecordTtl,
}: RecordEditFormProps) {
  return (
    <form className="form form--compact record-edit-form" onSubmit={onSubmit}>
      <label>
        Name
        <input
          value={editingRecordName}
          onChange={(event) => setEditingRecordName(event.target.value)}
          type="text"
          required
        />
      </label>

      <label>
        Type
        <select value={editingRecordType} onChange={(event) => setEditingRecordType(event.target.value)}>
          <option value="A">A</option>
          <option value="AAAA">AAAA</option>
          <option value="CNAME">CNAME</option>
          <option value="TXT">TXT</option>
          <option value="MX">MX</option>
        </select>
      </label>

      <label>
        Content
        <input
          value={editingRecordContent}
          onChange={(event) => setEditingRecordContent(event.target.value)}
          type="text"
          required
        />
      </label>

      <label>
        TTL
        <input
          value={editingRecordTtl}
          onChange={(event) => setEditingRecordTtl(event.target.value)}
          type="number"
          min="1"
          required
        />
      </label>

      <div className="actions-row actions-row--dns">
        <button type="submit" disabled={savingEditedRecord}>
          {savingEditedRecord ? "Saving..." : "Save"}
        </button>
        <button type="button" className="secondary-button" onClick={onCancel} disabled={savingEditedRecord}>
          Cancel
        </button>
      </div>
    </form>
  );
}
