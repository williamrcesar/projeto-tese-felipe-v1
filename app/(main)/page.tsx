'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { NewProjectDialog } from '@/components/new-project-dialog';
import { FolderPlus, Folder, FileText, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';

type Project = {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  documentCount: number;
};

export default function HomePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [newProjectDialogOpen, setNewProjectDialogOpen] = useState(false);

  const loadProjects = async () => {
    try {
      const res = await fetch('/api/projects');
      if (!res.ok) throw new Error('Falha ao carregar projetos');
      const data = await res.json();
      setProjects(data.projects || []);
    } catch (error: any) {
      toast.error(error.message || 'Erro ao carregar projetos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProjects();
  }, []);

  return (
    <div className="min-h-[calc(100vh-200px)] relative">
      {/* Subtle background lights - static */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none -z-10">
        <div className="absolute top-20 right-20 w-[500px] h-[500px] bg-red-500/3 rounded-full blur-[100px]"></div>
        <div className="absolute bottom-20 left-20 w-[400px] h-[400px] bg-red-600/2 rounded-full blur-[100px]"></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] bg-red-500/2 rounded-full blur-[120px]"></div>
      </div>

      <div className="space-y-8">
        {/* Header Section */}
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <h1 className="text-4xl font-bold bg-gradient-to-r from-white via-gray-100 to-gray-300 bg-clip-text text-transparent">
              Meus Projetos
            </h1>
            <p className="text-gray-400 text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-red-500" />
              Organize seus livros, teses e documentos com inteligência artificial
            </p>
          </div>
          <Button
            onClick={() => setNewProjectDialogOpen(true)}
            className="bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white shadow-lg shadow-red-500/20 transition-all transform hover:scale-105 active:scale-95 h-11 px-6"
          >
            <FolderPlus className="mr-2 h-5 w-5" />
            Novo Projeto
          </Button>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="relative">
              <div className="w-16 h-16 border-4 border-red-500/20 border-t-red-500 rounded-full animate-spin"></div>
              <div className="absolute inset-0 w-16 h-16 border-4 border-transparent border-t-red-600/40 rounded-full animate-spin animation-delay-150"></div>
            </div>
            <p className="text-gray-400 mt-6 text-sm">Carregando seus projetos...</p>
          </div>
        ) : projects.length === 0 ? (
          <div className="relative">
            <Card className="relative bg-gradient-to-br from-white/5 to-white/[0.02] backdrop-blur-xl border-white/10 shadow-2xl">
              <CardContent className="flex flex-col items-center justify-center py-16 px-8">
                <div className="relative mb-8">
                  <div className="absolute inset-0 bg-red-500/20 blur-3xl rounded-full"></div>
                  <div className="relative bg-gradient-to-br from-gray-800 to-gray-900 p-6 rounded-2xl border border-white/10">
                    <Folder className="h-16 w-16 text-red-500" />
                  </div>
                </div>
                <h3 className="text-2xl font-bold mb-3 bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                  Nenhum projeto criado
                </h3>
                <p className="text-gray-400 mb-8 text-center max-w-md">
                  Comece criando seu primeiro projeto para organizar e gerenciar seus documentos com o poder da IA
                </p>
                <Button
                  onClick={() => setNewProjectDialogOpen(true)}
                  className="bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white shadow-lg shadow-red-500/30 transition-all transform hover:scale-105 active:scale-95 h-12 px-8"
                >
                  <FolderPlus className="mr-2 h-5 w-5" />
                  Criar Primeiro Projeto
                </Button>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {projects.map((project, index) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="group"
                style={{
                  animation: `fadeInUp 0.5s ease-out ${index * 0.1}s both`
                }}
              >
                <div className="relative h-full">
                  {/* Glow effect on hover */}
                  <div className="absolute -inset-0.5 bg-gradient-to-r from-red-600 to-red-800 rounded-2xl opacity-0 group-hover:opacity-20 blur transition-all duration-300"></div>

                  <Card className="relative h-full bg-gradient-to-br from-white/[0.07] to-white/[0.02] backdrop-blur-xl border-white/10 hover:border-red-500/30 transition-all duration-300 group-hover:shadow-2xl group-hover:shadow-red-500/10 group-hover:-translate-y-1 cursor-pointer overflow-hidden">
                    {/* Animated gradient overlay */}
                    <div className="absolute inset-0 bg-gradient-to-br from-red-500/0 via-red-500/0 to-red-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>

                    <CardHeader className="relative">
                      <div className="flex items-start justify-between mb-4">
                        <div className="relative">
                          <div className="absolute inset-0 bg-red-500/20 blur-xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity"></div>
                          <div className="relative p-3 bg-gradient-to-br from-red-500/20 to-red-600/10 rounded-xl border border-red-500/20 group-hover:border-red-500/40 transition-colors">
                            <Folder className="h-7 w-7 text-red-500" />
                          </div>
                        </div>
                        <Badge
                          variant="secondary"
                          className="bg-white/10 text-gray-300 border-white/10 backdrop-blur-sm px-3 py-1"
                        >
                          <FileText className="h-3 w-3 mr-1.5" />
                          {project.documentCount} {project.documentCount === 1 ? 'doc' : 'docs'}
                        </Badge>
                      </div>
                      <CardTitle className="line-clamp-1 text-xl font-bold text-white group-hover:text-red-400 transition-colors">
                        {project.name}
                      </CardTitle>
                      <CardDescription className="line-clamp-2 text-gray-400 text-sm leading-relaxed">
                        {project.description || 'Sem descrição'}
                      </CardDescription>
                    </CardHeader>

                    {/* Bottom gradient bar */}
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-red-500/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                  </Card>
                </div>
              </Link>
            ))}
          </div>
        )}

        <NewProjectDialog
          open={newProjectDialogOpen}
          onOpenChange={setNewProjectDialogOpen}
          onProjectCreated={loadProjects}
        />
      </div>

      <style jsx>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .animation-delay-150 {
          animation-delay: 150ms;
        }
      `}</style>
    </div>
  );
}
