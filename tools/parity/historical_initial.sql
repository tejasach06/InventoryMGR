--
-- PostgreSQL database dump
--


-- Dumped from database version 17.11 (Debian 17.11-1.pgdg12+2)
-- Dumped by pg_dump version 17.11 (Debian 17.11-1.pgdg12+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: criticality; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.criticality AS ENUM (
    'low',
    'medium',
    'high',
    'critical'
);


--
-- Name: import_action; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.import_action AS ENUM (
    'create',
    'update',
    'conflict',
    'invalid'
);


--
-- Name: import_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.import_status AS ENUM (
    'previewed',
    'committed',
    'cancelled'
);


--
-- Name: lifecycle; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.lifecycle AS ENUM (
    'planned',
    'active',
    'retiring',
    'retired'
);


--
-- Name: platform; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.platform AS ENUM (
    'proxmox',
    'vmware'
);


--
-- Name: user_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_role AS ENUM (
    'admin',
    'editor',
    'viewer'
);


--
-- Name: vm_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.vm_status AS ENUM (
    'running',
    'stopped',
    'suspended',
    'unknown'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: alembic_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alembic_version (
    version_num character varying(32) NOT NULL
);


--
-- Name: csv_import_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.csv_import_batches (
    id uuid NOT NULL,
    filename character varying(255) NOT NULL,
    created_by_id uuid NOT NULL,
    status public.import_status NOT NULL,
    summary jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    committed_at timestamp with time zone
);


--
-- Name: csv_import_rows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.csv_import_rows (
    id uuid NOT NULL,
    batch_id uuid NOT NULL,
    row_number integer NOT NULL,
    raw jsonb NOT NULL,
    normalized jsonb,
    action public.import_action NOT NULL,
    target_vm_id uuid,
    errors jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    email character varying(320) NOT NULL,
    password_hash character varying(255) NOT NULL,
    role public.user_role NOT NULL,
    is_active boolean NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: vms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vms (
    id uuid NOT NULL,
    external_id character varying(255),
    name character varying(255) NOT NULL,
    platform public.platform NOT NULL,
    datacenter character varying(255),
    cluster character varying(255) NOT NULL,
    status public.vm_status NOT NULL,
    cpu_cores integer NOT NULL,
    memory_mb integer NOT NULL,
    disk_gb integer NOT NULL,
    os_name character varying(255),
    ip_addresses jsonb NOT NULL,
    owner character varying(255),
    notes text,
    backup_status character varying(255),
    ha_enabled boolean NOT NULL,
    criticality public.criticality NOT NULL,
    lifecycle public.lifecycle NOT NULL,
    tags jsonb NOT NULL,
    last_verified_at date,
    created_by_id uuid NOT NULL,
    updated_by_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT ck_vms_cluster_nonempty CHECK ((length(btrim((cluster)::text)) > 0)),
    CONSTRAINT ck_vms_cpu_cores_nonnegative CHECK ((cpu_cores >= 0)),
    CONSTRAINT ck_vms_disk_gb_nonnegative CHECK ((disk_gb >= 0)),
    CONSTRAINT ck_vms_memory_mb_nonnegative CHECK ((memory_mb >= 0)),
    CONSTRAINT ck_vms_name_nonempty CHECK ((length(btrim((name)::text)) > 0))
);


--
-- Name: alembic_version alembic_version_pkc; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alembic_version
    ADD CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num);


--
-- Name: csv_import_batches csv_import_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.csv_import_batches
    ADD CONSTRAINT csv_import_batches_pkey PRIMARY KEY (id);


--
-- Name: csv_import_rows csv_import_rows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.csv_import_rows
    ADD CONSTRAINT csv_import_rows_pkey PRIMARY KEY (id);


--
-- Name: csv_import_rows uq_csv_import_rows_batch_row; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.csv_import_rows
    ADD CONSTRAINT uq_csv_import_rows_batch_row UNIQUE (batch_id, row_number);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: vms vms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vms
    ADD CONSTRAINT vms_pkey PRIMARY KEY (id);


--
-- Name: ix_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_users_email ON public.users USING btree (email);


--
-- Name: ix_vms_cluster; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_vms_cluster ON public.vms USING btree (cluster);


--
-- Name: ix_vms_criticality; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_vms_criticality ON public.vms USING btree (criticality);


--
-- Name: ix_vms_lifecycle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_vms_lifecycle ON public.vms USING btree (lifecycle);


--
-- Name: ix_vms_platform; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_vms_platform ON public.vms USING btree (platform);


--
-- Name: ix_vms_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_vms_status ON public.vms USING btree (status);


--
-- Name: uq_vms_platform_external_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_vms_platform_external_id ON public.vms USING btree (platform, external_id) WHERE (external_id IS NOT NULL);


--
-- Name: uq_vms_platform_name_without_external_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_vms_platform_name_without_external_id ON public.vms USING btree (platform, lower((name)::text)) WHERE (external_id IS NULL);


--
-- Name: csv_import_batches csv_import_batches_created_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.csv_import_batches
    ADD CONSTRAINT csv_import_batches_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public.users(id);


--
-- Name: csv_import_rows csv_import_rows_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.csv_import_rows
    ADD CONSTRAINT csv_import_rows_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.csv_import_batches(id);


--
-- Name: csv_import_rows csv_import_rows_target_vm_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.csv_import_rows
    ADD CONSTRAINT csv_import_rows_target_vm_id_fkey FOREIGN KEY (target_vm_id) REFERENCES public.vms(id) ON DELETE SET NULL;


--
-- Name: vms vms_created_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vms
    ADD CONSTRAINT vms_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public.users(id);


--
-- Name: vms vms_updated_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vms
    ADD CONSTRAINT vms_updated_by_id_fkey FOREIGN KEY (updated_by_id) REFERENCES public.users(id);


--
-- PostgreSQL database dump complete
--

INSERT INTO public.alembic_version(version_num) VALUES ('0001_initial');
