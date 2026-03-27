import { Button, Card, Empty, Form, Input, List, Modal, Tag, Typography, message } from 'antd';
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Repository, Workspace } from '../types';
import { AppLayout } from '../components/AppLayout';

const { Title, Text } = Typography;

export function WorkspacesPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(false);
  const [workspaceModalOpen, setWorkspaceModalOpen] = useState(false);
  const [repositoryModalOpen, setRepositoryModalOpen] = useState(false);
  const [branchModalOpen, setBranchModalOpen] = useState(false);
  const [repositoryWorkspaceId, setRepositoryWorkspaceId] = useState('');
  const [editingRepository, setEditingRepository] = useState<{
    workspaceId: string;
    repository: Repository;
  } | null>(null);
  const [workspaceForm] = Form.useForm();
  const [repositoryForm] = Form.useForm();
  const [branchForm] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();

  async function refresh() {
    setLoading(true);
    try {
      setWorkspaces(await api.getWorkspaces());
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '加载工作区失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function createWorkspace(values: { name: string; description?: string }) {
    try {
      await api.createWorkspace(values);
      workspaceForm.resetFields();
      setWorkspaceModalOpen(false);
      await refresh();
      messageApi.success('工作区创建成功');
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '创建工作区失败');
    }
  }

  async function addRepository(values: { name: string; url: string; defaultBranch?: string }) {
    try {
      await api.addRepositoryToWorkspace(repositoryWorkspaceId, values);
      repositoryForm.resetFields();
      setRepositoryModalOpen(false);
      setRepositoryWorkspaceId('');
      await refresh();
      messageApi.success('代码库已拉取并加入工作区');
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '添加代码库失败');
    }
  }

  async function updateBranch(values: { currentBranch: string }) {
    if (!editingRepository) {
      return;
    }
    try {
      await api.updateRepositoryBranch(editingRepository.workspaceId, editingRepository.repository.id, values);
      branchForm.resetFields();
      setBranchModalOpen(false);
      setEditingRepository(null);
      await refresh();
      messageApi.success('分支已切换并同步');
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '更新分支失败');
    }
  }

  return (
    <AppLayout>
      {contextHolder}
      <Modal
        title="创建工作区"
        open={workspaceModalOpen}
        footer={null}
        onCancel={() => setWorkspaceModalOpen(false)}
      >
        <Form form={workspaceForm} layout="vertical" onFinish={(values) => void createWorkspace(values)}>
          <Form.Item name="name" label="工作区名称" rules={[{ required: true, message: '请输入工作区名称' }]}>
            <Input placeholder="例如：FlowX 平台" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} placeholder="说明这个工作区对应的项目或业务边界。" />
          </Form.Item>
          <Button type="primary" htmlType="submit" className="accent-button">
            创建工作区
          </Button>
        </Form>
      </Modal>
      <Modal
        title="收录代码库"
        open={repositoryModalOpen}
        footer={null}
        onCancel={() => setRepositoryModalOpen(false)}
      >
        <Form form={repositoryForm} layout="vertical" onFinish={(values) => void addRepository(values)}>
          <Form.Item name="name" label="代码库名称" rules={[{ required: true, message: '请输入代码库名称' }]}>
            <Input placeholder="例如：flowx-web" />
          </Form.Item>
          <Form.Item name="url" label="仓库地址" rules={[{ required: true, message: '请输入仓库地址' }]}>
            <Input placeholder="https://github.com/org/repo" />
          </Form.Item>
          <Form.Item name="defaultBranch" label="默认分支">
            <Input placeholder="main / master / develop" />
          </Form.Item>
          <Button type="primary" htmlType="submit" className="accent-button">
            添加代码库
          </Button>
        </Form>
      </Modal>
      <Modal
        title="更新当前分支"
        open={branchModalOpen}
        footer={null}
        onCancel={() => {
          setBranchModalOpen(false);
          setEditingRepository(null);
        }}
      >
        <Form form={branchForm} layout="vertical" onFinish={(values) => void updateBranch(values)}>
          <Form.Item name="currentBranch" label="当前分支" rules={[{ required: true, message: '请输入当前分支' }]}>
            <Input placeholder="例如：feature/workspace-page" />
          </Form.Item>
          <Button type="primary" htmlType="submit" className="accent-button">
            保存分支
          </Button>
        </Form>
      </Modal>

      <div className="page-hero">
        <Text className="eyebrow">Workspace</Text>
        <Title level={2}>项目工作区与代码库</Title>
      </div>
      <Card className="panel" bordered={false} loading={loading}>
        <div className="panel-heading panel-heading-inline">
          <div>
            <Text className="eyebrow">Project Space</Text>
            <Title level={4}>按项目组织需求上下文</Title>
          </div>
          <Button className="accent-button" type="primary" onClick={() => setWorkspaceModalOpen(true)}>
            新建工作区
          </Button>
        </div>
        <List
          dataSource={workspaces}
          locale={{ emptyText: <Empty description="暂无工作区" /> }}
          renderItem={(workspace) => (
            <List.Item className="workspace-item">
              <div className="workspace-copy">
                <Text strong>{workspace.name}</Text>
                <Text className="requirement-criteria">{workspace.description || '未填写描述'}</Text>
                <div className="workspace-meta-row">
                  <Tag bordered={false} color="gold">
                    {workspace.repositories.length} 个代码库
                  </Tag>
                  <Tag bordered={false} color="geekblue">
                    {workspace._count?.requirements ?? 0} 条需求
                  </Tag>
                </div>
                {workspace.repositories.length > 0 ? (
                  <div className="repo-list">
                    {workspace.repositories.map((repository) => (
                      <div key={repository.id} className="repo-row">
                        <div>
                          <Text strong>{repository.name}</Text>
                          <div className="repo-meta-row">
                            <Tag bordered={false}>默认分支 {repository.defaultBranch ?? '未设置'}</Tag>
                            <Tag bordered={false} color="processing">
                              当前分支 {repository.currentBranch ?? repository.defaultBranch ?? '未设置'}
                            </Tag>
                            <Tag
                              bordered={false}
                              color={
                                repository.syncStatus === 'READY'
                                  ? 'success'
                                  : repository.syncStatus === 'ERROR'
                                    ? 'error'
                                    : 'gold'
                              }
                            >
                              同步状态 {repository.syncStatus ?? 'PENDING'}
                            </Tag>
                          </div>
                          <Text className="requirement-criteria">{repository.localPath ?? '尚未落盘到本地'}</Text>
                          {repository.syncError ? (
                            <Text type="danger" className="requirement-criteria">
                              同步失败：{repository.syncError}
                            </Text>
                          ) : null}
                        </div>
                        <Button
                          className="ghost-button"
                          onClick={() => {
                            setEditingRepository({ workspaceId: workspace.id, repository });
                            branchForm.setFieldsValue({
                              currentBranch: repository.currentBranch ?? repository.defaultBranch ?? '',
                            });
                            setBranchModalOpen(true);
                          }}
                        >
                          切换分支
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              <Button
                className="ghost-button"
                onClick={() => {
                  setRepositoryWorkspaceId(workspace.id);
                  setRepositoryModalOpen(true);
                }}
              >
                添加代码库
              </Button>
            </List.Item>
          )}
        />
      </Card>
    </AppLayout>
  );
}
