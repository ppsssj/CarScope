import { useId } from "react";
import type { Task } from "./model";
/** Original interface illustration, not an engineering model, real photograph or vehicle position. */
export function PartObject({
  task,
  mode = "object",
  spread = 0,
  turn = 0,
}: {
  task: Task;
  mode?: "instrument" | "object" | "ink";
  spread?: number;
  turn?: number;
}) {
  const uid = useId().replaceAll(":", ""),
    a = uid + "a",
    b = uid + "b";
  const light =
      mode === "ink"
        ? "#ffffff"
        : mode === "instrument"
          ? "#565e5e"
          : "#f4efff",
    dark =
      mode === "ink"
        ? "#d6dbdd"
        : mode === "instrument"
          ? "#202829"
          : "#8a78ad",
    accent =
      mode === "instrument"
        ? "#eab953"
        : mode === "ink"
          ? "#315bd8"
          : "#6344d4";
  const raised = spread * 0.35;
  return (
    <svg
      className={`part-object ${mode}`}
      viewBox="0 0 500 400"
      role="img"
      aria-label={`${task.label} 설명용 도형. 실제 차량의 모양이나 위치를 나타내지 않습니다.`}
    >
      <defs>
        <linearGradient id={a} x1="0" y1="0" x2=".8" y2="1">
          <stop stopColor={light} />
          <stop offset="1" stopColor={dark} />
        </linearGradient>
        <linearGradient id={b} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor={accent} />
          <stop
            offset="1"
            stopColor={mode === "instrument" ? "#947237" : "#34226b"}
          />
        </linearGradient>
      </defs>
      <ellipse
        cx="250"
        cy="337"
        rx="140"
        ry="19"
        fill={
          mode === "ink"
            ? "#e8e6e0"
            : mode === "instrument"
              ? "#101617"
              : "#d1c7eb"
        }
      />
      <g
        transform={`translate(250 205) rotate(${turn}) translate(-250 -205)`}
        stroke={mode === "ink" ? "#25333c" : "#32313d"}
        strokeWidth={mode === "ink" ? 2 : 1.5}
        strokeLinejoin="round"
      >
        {task.kind === "cap" && (
          <>
            <path d="M188 237h124l-9 76q-53 24-106 0z" fill={`url(#${a})`} />
            <ellipse cx="250" cy="238" rx="62" ry="20" fill="#3c3f45" />
            <g transform={`translate(0 ${-raised})`}>
              <path
                d="M139 161q111-61 222 0v40q-111 67-222 0z"
                fill={`url(#${b})`}
              />
              <ellipse cx="250" cy="161" rx="111" ry="44" fill={accent} />
              {Array.from({ length: 14 }, (_, i) => (
                <path
                  key={i}
                  d={`M${149 + i * 15} 181v25`}
                  stroke={mode === "ink" ? "#25333c" : "#afa3c9"}
                  opacity=".7"
                />
              ))}
              <path
                d="M204 164q46-45 92 0l-14 17q-32-22-64 0zM221 140l-8-17m37 7v-17m29 27l8-17"
                fill="none"
                stroke={mode === "instrument" ? "#222c2e" : "#f5f2ff"}
                strokeWidth="6"
              />
              <path d="M298 174h51l24 18-18 12-48-13" fill={accent} />
            </g>
            <path
              d="M312 241q64-12 50-45"
              fill="none"
              stroke={accent}
              strokeWidth="9"
            />
          </>
        )}
        {task.kind === "wheel" && (
          <>
            <ellipse cx="251" cy="210" rx="126" ry="132" fill="#252c30" />
            {Array.from({ length: 28 }, (_, i) => (
              <path
                key={i}
                d="M244 82l14 16"
                transform={`rotate(${(i * 360) / 28} 250 210)`}
                stroke="#687076"
                strokeWidth="5"
              />
            ))}
            <circle cx="250" cy="210" r="99" fill={`url(#${a})`} />
            <circle cx="250" cy="210" r="78" fill="#3c444e" />
            {Array.from({ length: 5 }, (_, i) => (
              <path
                key={i}
                d="M237 197l-9-60 34-5 2 64z"
                transform={`rotate(${i * 72} 250 210)`}
                fill={light}
              />
            ))}
            <circle cx="250" cy="210" r="28" fill={accent} />
            <circle cx="250" cy="210" r="9" fill="#252c30" />
          </>
        )}
        {task.kind === "reservoir" && (
          <>
            <path
              d="M171 146l34-24h95l32 26 14 142-28 27H183l-26-29z"
              fill={`url(#${a})`}
            />
            <path d="M179 222h143l-6 72H188z" fill={accent} opacity=".36" />
            <path
              d="M184 171h130M192 206h32m-32 48h32"
              stroke={mode === "ink" ? "#25333c" : "#e5dcf7"}
              strokeWidth="3"
            />
            <path
              d="M219 93h65v31h-65z"
              fill={`url(#${b})`}
              transform={`translate(0 ${-raised})`}
            />
            <ellipse cx="251" cy={93 - raised} rx="33" ry="12" fill={accent} />
            <text
              x="280"
              y="209"
              fontSize="13"
              fill={mode === "instrument" ? "#fff" : "#1c2141"}
              stroke="none"
            >
              MAX
            </text>
            <text
              x="280"
              y="258"
              fontSize="13"
              fill={mode === "instrument" ? "#fff" : "#1c2141"}
              stroke="none"
            >
              MIN
            </text>
            <path
              d="M328 252h38l19 24"
              fill="none"
              stroke={dark}
              strokeWidth="17"
            />
          </>
        )}
        {task.kind === "battery" && (
          <>
            <path d="M142 147l162-37 57 52v137l-162 40-57-54z" fill={dark} />
            <path d="M142 147l57 52 162-37-57-52z" fill={light} />
            <path d="M199 199v140l162-40V162z" fill={`url(#${a})`} />
            <g transform={`translate(0 ${-raised})`}>
              <path
                d="M163 130v-25l27-6v27m111-3v-26l27 22v26"
                strokeWidth="16"
                stroke={accent}
              />
            </g>
            <text
              x="230"
              y="278"
              fontSize="49"
              fontWeight="700"
              fill={mode === "ink" ? "#25333c" : "#fff"}
              stroke="none"
            >
              12V
            </text>
            <path d="M221 175l68-15" stroke={accent} strokeWidth="5" />
          </>
        )}
        {task.kind === "fuse" && (
          <>
            <path d="M141 172l155-45 70 40v137l-157 41-68-45z" fill={dark} />
            <path d="M155 173l141-37 53 31-140 39z" fill="#252d36" />
            {Array.from({ length: 12 }, (_, i) => (
              <rect
                key={i}
                x={178 + (i % 4) * 31}
                y={169 + Math.floor(i / 4) * 28}
                width="21"
                height="17"
                rx="3"
                fill={i % 3 === 0 ? accent : light}
              />
            ))}
            <g transform={`translate(0 ${-raised - 15})`}>
              <path d="M136 117l160-39 74 43-160 44z" fill={`url(#${a})`} />
              <path d="M210 165v21l160-44v-21" fill={dark} />
              <path d="M228 127l30-12-7 14 22-4-30 21 7-16z" fill={accent} />
            </g>
          </>
        )}
        {task.kind === "lamp" && (
          <>
            <path
              d="M122 180q123-115 252-38l-18 127q-117 70-226 10z"
              fill={dark}
            />
            <path
              d="M135 184q107-91 220-33l-16 101q-101 50-197 14z"
              fill={`url(#${a})`}
            />
            {Array.from({ length: 6 }, (_, i) => (
              <path
                key={i}
                d={`M${161 + i * 29} ${182 - i * 4}v72`}
                stroke={accent}
                strokeWidth="8"
              />
            ))}
            <path
              d="M141 203q109-72 200-37"
              fill="none"
              stroke={light}
              strokeWidth="6"
            />
            <path
              d="M132 279l-10 25m215-32l12 22"
              strokeWidth="15"
              stroke={dark}
            />
          </>
        )}
        {task.kind === "wiper" && (
          <>
            <path
              d="M125 301l141-99 70-81"
              fill="none"
              stroke={dark}
              strokeWidth="14"
            />
            <path
              d="M166 278l114-86"
              fill="none"
              stroke={light}
              strokeWidth="7"
            />
            <g transform={`translate(0 ${-raised})`}>
              <path d="M239 106l126-39 20 23-130 43z" fill={dark} />
              <path d="M248 104l115-31 8 10-115 36z" fill={accent} />
            </g>
            <circle cx="125" cy="301" r="17" fill={accent} />
            <path d="M97 312h61" stroke={dark} strokeWidth="10" />
          </>
        )}
        {task.kind === "port" && (
          <>
            <path
              d="M155 139l101-31 91 53v133l-101 31-91-53z"
              fill={`url(#${a})`}
            />
            <ellipse cx="251" cy="210" rx="66" ry="79" fill="#262d36" />
            {[
              [228, 172],
              [272, 172],
              [213, 210],
              [250, 210],
              [286, 210],
              [231, 249],
              [271, 249],
            ].map(([x, y], i) => (
              <ellipse
                key={i}
                cx={x}
                cy={y}
                rx="8"
                ry="12"
                fill={light}
                stroke={accent}
                strokeWidth="3"
              />
            ))}
            <path
              d="M153 139l-71-43v137l71 39"
              fill={accent}
              transform={`translate(${-raised * 0.5} 0)`}
            />
          </>
        )}
      </g>
      <g
        fill={mode === "instrument" ? "#a8b3b2" : "#534d65"}
        fontFamily="monospace"
        fontSize="10"
      >
        <text x="28" y="32">
          {task.code} / {task.kind.toUpperCase()}
        </text>
        <text x="28" y="377">
          SCHEMATIC · NOT VEHICLE GEOMETRY
        </text>
      </g>
    </svg>
  );
}
