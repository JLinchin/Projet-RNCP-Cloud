{{- define "library.labels" -}}
app.kubernetes.io/part-of: library
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/version: {{ .Values.image.tag | quote }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end }}

{{- define "library.image" -}}
{{ .root.Values.image.registry }}/biblio-{{ .name }}:{{ .tag | default .root.Values.image.tag }}
{{- end }}

{{/* Durcissement commun des pods (ISO 27001 A.8.9 configuration sécurisée). */}}
{{- define "library.podSecurity" -}}
runAsNonRoot: true
seccompProfile:
  type: RuntimeDefault
{{- end }}

{{- define "library.containerSecurity" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities:
  drop: ["ALL"]
{{- end }}

{{/* Variables d'environnement partagées back-end / worker : secrets injectés un par un. */}}
{{- define "library.dataEnv" -}}
- name: PGPASSWORD
  valueFrom: { secretKeyRef: { name: {{ .Values.secrets.postgres }}, key: APP_DB_PASSWORD } }
- name: RABBITMQ_USER
  valueFrom: { secretKeyRef: { name: {{ .Values.secrets.rabbitmq }}, key: RABBITMQ_USER } }
- name: RABBITMQ_PASSWORD
  valueFrom: { secretKeyRef: { name: {{ .Values.secrets.rabbitmq }}, key: RABBITMQ_PASSWORD } }
- name: S3_ACCESS_KEY
  valueFrom: { secretKeyRef: { name: {{ .Values.secrets.s3App }}, key: S3_ACCESS_KEY } }
- name: S3_SECRET_KEY
  valueFrom: { secretKeyRef: { name: {{ .Values.secrets.s3App }}, key: S3_SECRET_KEY } }
{{- end }}

{{- define "library.backendPod" -}}
metadata:
  labels:
    app.kubernetes.io/name: backend
    track: {{ .track }}
    biblio/db-access: "true"
    biblio/s3-access: "true"
    biblio/amqp-access: "true"
    {{- include "library.labels" .root | nindent 4 }}
  annotations:
    checksum/config: {{ include (print .root.Template.BasePath "/configmap.yaml") .root | sha256sum }}
spec:
  automountServiceAccountToken: false
  terminationGracePeriodSeconds: 30
  securityContext:
    runAsUser: 1000
    runAsGroup: 1000
    {{- include "library.podSecurity" .root | nindent 4 }}
  topologySpreadConstraints:
    - maxSkew: 1
      topologyKey: kubernetes.io/hostname
      whenUnsatisfiable: ScheduleAnyway
      labelSelector:
        matchLabels: { app.kubernetes.io/name: backend }
  containers:
    - name: backend
      image: {{ include "library.image" (dict "root" .root "name" "backend" "tag" .tag) }}
      imagePullPolicy: {{ .root.Values.image.pullPolicy }}
      ports:
        - { name: http, containerPort: 3000 }
      envFrom:
        - configMapRef: { name: library-config }
      env:
        - name: APP_VERSION
          value: {{ .tag | default .root.Values.image.tag | quote }}
        - name: JWT_SECRET
          valueFrom: { secretKeyRef: { name: {{ .root.Values.secrets.app }}, key: JWT_SECRET } }
        - name: ADMIN_EMAIL
          valueFrom: { secretKeyRef: { name: {{ .root.Values.secrets.app }}, key: ADMIN_EMAIL } }
        - name: ADMIN_PASSWORD
          valueFrom: { secretKeyRef: { name: {{ .root.Values.secrets.app }}, key: ADMIN_PASSWORD } }
        {{- include "library.dataEnv" .root | nindent 8 }}
      startupProbe:
        httpGet: { path: /healthz, port: http }
        periodSeconds: 2
        failureThreshold: 30
      readinessProbe:
        httpGet: { path: /readyz, port: http }
        periodSeconds: 5
      livenessProbe:
        httpGet: { path: /healthz, port: http }
        periodSeconds: 10
      lifecycle:
        # Laisse le temps aux endpoints d'être retirés avant SIGTERM (zéro requête perdue en rolling update).
        preStop:
          exec: { command: ["sleep", "5"] }
      resources: {{- toYaml .root.Values.backend.resources | nindent 8 }}
      securityContext: {{- include "library.containerSecurity" .root | nindent 8 }}
{{- end }}
