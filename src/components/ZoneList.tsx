type Zone = {
  id: string;
  organizationId: string;
  name: string;
  provider: string;
  powerdnsZoneId: string;
  createdAt: string;
};

type ZoneListProps = {
  zones: Zone[];
  selectedZoneId: string;
  isOrgAdmin: boolean;
  deletingZoneId: string | null;
  onSelectZone: (zoneId: string) => void;
  onDeleteZone: (zone: Zone) => void | Promise<void>;
};

export function ZoneList({
  zones,
  selectedZoneId,
  isOrgAdmin,
  deletingZoneId,
  onSelectZone,
  onDeleteZone,
}: ZoneListProps) {
  return (
    <section className="panel dns-panel dns-panel--zones">
      <div className="panel__header">
        <h3>Zones</h3>
        <span className="section-tag">{isOrgAdmin ? "Admin can edit" : "Read only"}</span>
      </div>
      <ul className="list">
        {zones.length === 0 ? <li className="empty-state">No zones created yet.</li> : null}
        {zones.map((zone) => (
          <li
            key={zone.id}
            className={`list__item zone-list-item${selectedZoneId === zone.id ? " zone-list-item--selected" : ""}`}
          >
            <div>
              <strong>{zone.name}</strong>
              <p>{zone.provider}</p>
              <code>{zone.powerdnsZoneId}</code>
            </div>
            <div className="actions-row actions-row--dns">
              <button
                type="button"
                className="secondary-button"
                onClick={() => onSelectZone(zone.id)}
              >
                {selectedZoneId === zone.id ? "Selected" : "Open records"}
              </button>
              {isOrgAdmin ? (
                <button
                  type="button"
                  className="secondary-button secondary-button--danger"
                  onClick={() => void onDeleteZone(zone)}
                  disabled={deletingZoneId === zone.id}
                >
                  {deletingZoneId === zone.id ? "Deleting..." : "Delete zone"}
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
