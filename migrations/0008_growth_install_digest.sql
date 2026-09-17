create table growth_install_digest_reports (
  email_lookup_hmac text not null,
  email_key_version smallint not null check (email_key_version > 0),
  first_install_observation_id uuid not null references growth_observations(id) on delete cascade,
  digest_job_id uuid not null references growth_jobs(id) on delete cascade,
  reported_at timestamptz not null,
  primary key (email_key_version, email_lookup_hmac)
);
create index growth_install_digest_reports_job on growth_install_digest_reports(digest_job_id);
