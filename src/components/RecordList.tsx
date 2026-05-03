import type { FormEvent } from "react";
import { RecordEditForm } from "./RecordEditForm";

type RecordRow = {
  name: string;
  type: string;
  ttl: number;
  records: Array<{
    content: string;
    disabled?: boolean;
  }>;
};

type RecordListProps = {
  selectedZoneName: string | null;
  selectedZoneId: string;
  recordsLoading: boolean;
  records: RecordRow[];
  isOrgAdmin: boolean;
  editingRecordKey: string | null;
  editingRecordName: string;
  editingRecordType: string;
  editingRecordContent: string;
  editingRecordTtl: string;
  savingEditedRecord: boolean;
  deletingRecordKey: string | null;
  onStartRecordEdit: (rrset: RecordRow, content: string) => void;
  onCancelRecordEdit: () => void;
  onDeleteRecord: (name: string, type: string, content: string) => void | Promise<void>;
  onRecordEditSubmit: (
    event: FormEvent<HTMLFormElement>,
    currentName: string,
    currentType: string,
    currentContent: string,
  ) => void | Promise<void>;
  setEditingRecordName: (value: string) => void;
  setEditingRecordType: (value: string) => void;
  setEditingRecordContent: (value: string) => void;
  setEditingRecordTtl: (value: string) => void;
};

export function RecordList({
  selectedZoneName,
  selectedZoneId,
  recordsLoading,
  records,
  isOrgAdmin,
  editingRecordKey,
  editingRecordName,
  editingRecordType,
  editingRecordContent,
  editingRecordTtl,
  savingEditedRecord,
  deletingRecordKey,
  onStartRecordEdit,
  onCancelRecordEdit,
  onDeleteRecord,
  onRecordEditSubmit,
  setEditingRecordName,
  setEditingRecordType,
  setEditingRecordContent,
  setEditingRecordTtl,
}: RecordListProps) {
  return (
    <section className="panel dns-panel dns-panel--records">
      <h3>{selectedZoneName ?? "Select a zone"}</h3>
      <p className="section-subtitle">
        {selectedZoneName
          ? "Records are loaded directly from PowerDNS for the selected zone."
          : "Choose a zone to inspect and manage its records."}
      </p>
      {recordsLoading ? <p>Loading records...</p> : null}
      {!recordsLoading && selectedZoneId ? (
        <ul className="list">
          {records.flatMap((rrset) =>
            rrset.records.map((record) => {
              const key = `${rrset.name}:${rrset.type}:${record.content}`;
              const isEditing = editingRecordKey === key;

              return (
                <li key={key} className="list__item">
                  <div className="record-item">
                    <div>
                      <strong>
                        {rrset.name} {rrset.type}
                      </strong>
                      <p>
                        TTL {rrset.ttl} • {record.content}
                      </p>
                    </div>

                    {isEditing ? (
                      <RecordEditForm
                        editingRecordName={editingRecordName}
                        editingRecordType={editingRecordType}
                        editingRecordContent={editingRecordContent}
                        editingRecordTtl={editingRecordTtl}
                        savingEditedRecord={savingEditedRecord}
                        onSubmit={(event) =>
                          void onRecordEditSubmit(event, rrset.name, rrset.type, record.content)
                        }
                        onCancel={onCancelRecordEdit}
                        setEditingRecordName={setEditingRecordName}
                        setEditingRecordType={setEditingRecordType}
                        setEditingRecordContent={setEditingRecordContent}
                        setEditingRecordTtl={setEditingRecordTtl}
                      />
                    ) : null}
                  </div>
                  {isOrgAdmin ? (
                    <div className="actions-row actions-row--dns">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => onStartRecordEdit(rrset, record.content)}
                        disabled={Boolean(editingRecordKey && !isEditing)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="secondary-button secondary-button--danger"
                        onClick={() => void onDeleteRecord(rrset.name, rrset.type, record.content)}
                        disabled={deletingRecordKey === key || savingEditedRecord}
                      >
                        {deletingRecordKey === key ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            }),
          )}
        </ul>
      ) : null}
      {!recordsLoading && selectedZoneId && records.length === 0 ? (
        <p className="empty-state">No records found for the selected zone.</p>
      ) : null}
    </section>
  );
}
