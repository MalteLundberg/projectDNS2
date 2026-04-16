grant select on users to projectdns2_app;
grant select on user_sessions to projectdns2_app;

grant select, insert on organizations to projectdns2_app;
grant select, insert on organization_members to projectdns2_app;
grant select, insert, update on invitations to projectdns2_app;
grant select, insert on dns_zones to projectdns2_app;
